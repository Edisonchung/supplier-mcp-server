// controllers/clientInvoiceController.js
// Client Invoice Extraction Controller - Following existing patterns
// Supports: Flow Solution, Broadwater, EMI Technology, EMI Automation

const fs = require('fs');
const MCPPromptService = require('../services/MCPPromptService');

class ClientInvoiceController {
  
  /**
   * Extract data from client/sales invoice PDF
   * POST /api/extract-invoice
   */
  async extractFromPDF(req, res) {
    const startTime = Date.now();
    
    console.log('🧾 ====== CLIENT INVOICE EXTRACTION STARTED ======');
    console.log('Timestamp:', new Date().toISOString());
    
    try {
      // Validate file
      const file = req.file;
      if (!file) {
        console.error('❌ No file provided');
        return res.status(400).json({
          success: false,
          error: 'No file provided',
          code: 'NO_FILE'
        });
      }
      
      console.log('📄 Processing file:', {
        originalName: file.originalname,
        mimetype: file.mimetype,
        size: file.size
      });
      
      // Extract user context
      const userContext = req.userContext || {
        email: req.body.userEmail || req.body.email || req.headers['x-user-email'] || 'anonymous',
        role: req.body.role || 'user',
        uid: req.body.uid || null
      };
      
      console.log('👤 User context:', userContext);
      
      // Detect company format from filename
      const companyFormat = this.detectCompanyFormat(file.originalname);
      console.log('🏢 Detected company format:', companyFormat);
      
      // Get MCP prompt for client invoice extraction
      let selectedPrompt = null;
      let promptSource = 'default';
      
      try {
        if (MCPPromptService) {
          const prompts = await MCPPromptService.getPromptsByCategory('client_invoice');
          
          if (prompts && prompts.length > 0) {
            // Try to find company-specific prompt first
            selectedPrompt = prompts.find(p => 
              p.name?.toLowerCase().includes(companyFormat.toLowerCase()) ||
              p.suppliers?.includes(companyFormat)
            );
            
            // Fallback to generic client invoice prompt
            if (!selectedPrompt) {
              selectedPrompt = prompts.find(p => 
                p.name?.toLowerCase().includes('client invoice') ||
                p.id === 'client_invoice_extraction'
              );
            }
            
            if (selectedPrompt) {
              promptSource = 'mcp_firestore';
              console.log('✅ Using MCP prompt:', selectedPrompt.name);
            }
          }
        }
      } catch (promptError) {
        console.warn('⚠️ MCP prompt fetch failed, using default:', promptError.message);
      }
      
      // Use default prompt if MCP not available
      if (!selectedPrompt) {
        selectedPrompt = this.getDefaultPrompt(companyFormat);
        promptSource = 'default_fallback';
        console.log('📋 Using default prompt for:', companyFormat);
      }
      
      // Call AI extraction service
      const extractionResult = await this.callAIExtraction(file, selectedPrompt, userContext);
      
      // Process and normalize the extracted data
      const processedData = this.processExtractedData(extractionResult, companyFormat, file);
      
      // Detect job codes from all locations
      const detectedJobCodes = this.detectAllJobCodes(processedData);
      processedData.detectedJobCodes = detectedJobCodes;
      processedData.linkedJobCodes = detectedJobCodes.map(jc => ({ id: jc, jobCode: jc }));
      processedData.jobCodes = detectedJobCodes;
      
      const processingTime = Date.now() - startTime;
      
      console.log('✅ ====== CLIENT INVOICE EXTRACTION COMPLETED ======');
      console.log('Processing time:', processingTime, 'ms');
      console.log('Invoice number:', processedData.invoiceNumber);
      console.log('Detected job codes:', detectedJobCodes);
      console.log('Items extracted:', processedData.items?.length || 0);
      
      return res.json({
        success: true,
        data: processedData,
        extraction_metadata: {
          documentType: 'client_invoice',
          companyFormat: companyFormat,
          promptUsed: selectedPrompt?.name || 'default',
          promptSource: promptSource,
          processingTime: processingTime,
          confidence: extractionResult.confidence || 0.85,
          jobCodesDetected: detectedJobCodes.length,
          itemsExtracted: processedData.items?.length || 0,
          userEmail: userContext.email,
          timestamp: new Date().toISOString()
        }
      });
      
    } catch (error) {
      console.error('❌ Client invoice extraction failed:', error);
      
      return res.status(500).json({
        success: false,
        error: 'Client invoice extraction failed',
        details: error.message,
        code: 'EXTRACTION_FAILED'
      });
    }
  }
  
  /**
   * Detect company format from filename or content
   */
  detectCompanyFormat(filename) {
    const name = (filename || '').toLowerCase();
    
    if (name.includes('bws') || name.includes('broadwater')) {
      return 'BROADWATER';
    }
    if (name.includes('emit-') || name.includes('emi_technology')) {
      return 'EMI_TECHNOLOGY';
    }
    if (name.includes('emi-inv') || name.includes('emi_automation') || name.includes('emi automation')) {
      return 'EMI_AUTOMATION';
    }
    if (name.includes('ptp') || name.includes('flow') || name.includes('fs-')) {
      return 'FLOW_SOLUTION';
    }
    
    // Check invoice number patterns in filename
    if (name.match(/bws-inv/i)) return 'BROADWATER';
    if (name.match(/emit-inv/i)) return 'EMI_TECHNOLOGY';
    if (name.match(/emi-inv\d/i)) return 'EMI_AUTOMATION';
    
    return 'FLOW_SOLUTION'; // Default
  }
  
  /**
   * Get default extraction prompt based on company
   */
  getDefaultPrompt(companyFormat) {
    const basePrompt = `Extract CLIENT INVOICE (Sales Invoice) data from this document.

CRITICAL: This is an OUTGOING invoice FROM our company TO a client.

=== COMPANY FORMAT: ${companyFormat} ===

JOB CODE DETECTION - Look in these locations:
- Flow Solution: END of line item descriptions (e.g., "...brake motor. FS-S5054")
- Broadwater: REMARK field (e.g., "BWS-S1022")
- EMI Technology: OUR REFERENCE field (e.g., "EMIT-S001")
- EMI Automation: May not have job codes

Job code pattern: 2-4 uppercase letters + hyphen + optional letter + 3-5 digits
Examples: FS-S5054, BWS-S1022, EMIT-S001

=== EXTRACT THESE FIELDS ===

HEADER:
- invoiceNumber: Invoice number
- date: Invoice date (convert DD/MM/YYYY to YYYY-MM-DD)
- deliveryOrderNo: DO number
- yourOrderNo: Client's PO number
- terms: Payment terms
- remark: Remark field (may contain job code)
- ourReference: Our Reference field (may contain job code)

CLIENT (SOLD TO):
- clientName: Company name
- clientAddress: Full address

LINE ITEMS (array):
- itemNumber, productCode, description, quantity, unitPrice, amount
- jobCode: Detected from description if present

TOTALS:
- subtotal, total, currency (default MYR)

BANK DETAILS:
- beneficiary, bankName, accountNumber

Return JSON format.`;

    return {
      id: `default_${companyFormat.toLowerCase()}`,
      name: `Default ${companyFormat} Invoice Extraction`,
      prompt: basePrompt,
      temperature: 0.1,
      maxTokens: 2500
    };
  }
  
  /**
   * Call AI extraction service
   */
  async callAIExtraction(file, prompt, userContext) {
    // Try to use UnifiedAIService if available
    try {
      const UnifiedAIService = require('../services/ai/UnifiedAIService');
      const aiService = new UnifiedAIService();
      
      const result = await aiService.extractDocument({
        file: file,
        documentType: 'client_invoice',
        prompt: prompt.prompt,
        temperature: prompt.temperature || 0.1,
        maxTokens: prompt.maxTokens || 2500,
        userContext: userContext
      });
      
      return result;
      
    } catch (aiError) {
      console.warn('⚠️ UnifiedAIService not available, using DeepSeek directly');
      
      // Fallback to direct DeepSeek call
      return this.callDeepSeekDirectly(file, prompt);
    }
  }
  
  /**
   * Direct DeepSeek API call as fallback
   */
  async callDeepSeekDirectly(file, prompt) {
    const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
    
    if (!DEEPSEEK_API_KEY) {
      throw new Error('DEEPSEEK_API_KEY not configured');
    }
    
    // FIX: Read from file.path (disk) OR file.buffer (memory)
    const pdfParse = require('pdf-parse');
    
    let pdfBuffer;
    if (file.buffer) {
      pdfBuffer = file.buffer;
    } else if (file.path) {
      pdfBuffer = fs.readFileSync(file.path);
    } else {
      throw new Error('No file buffer or path available');
    }
    
    const pdfData = await pdfParse(pdfBuffer);
    const textContent = pdfData.text;
    
    console.log('📄 Extracted PDF text length:', textContent.length);
    console.log('📄 PDF text preview:', textContent.substring(0, 500));
    
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: prompt.prompt
          },
          {
            role: 'user',
            content: `Extract data from this invoice:\n\n${textContent}`
          }
        ],
        temperature: prompt.temperature || 0.1,
        max_tokens: prompt.maxTokens || 2500
      })
    });
    
    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`);
    }
    
    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '';
    
    // Parse JSON from response
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return {
          data: JSON.parse(jsonMatch[0]),
          confidence: 0.85,
          provider: 'deepseek'
        };
      }
    } catch (parseError) {
      console.warn('⚠️ Failed to parse AI response as JSON');
    }
    
    return {
      data: { rawText: content },
      confidence: 0.5,
      provider: 'deepseek'
    };
  }
  
  /**
   * Process and normalize extracted data
   */
  processExtractedData(extractionResult, companyFormat, file) {
    const data = extractionResult.data || extractionResult;
    
    // Base structure
    const processed = {
      documentType: 'client_invoice',
      companyFormat: companyFormat,
      
      // Header
      invoiceNumber: this.extractField(data, ['invoiceNumber', 'invoice_number', 'invoiceNo']),
      invoiceDate: this.normalizeDate(this.extractField(data, ['date', 'invoiceDate', 'invoice_date'])),
      dueDate: this.normalizeDate(this.extractField(data, ['dueDate', 'due_date'])),
      deliveryOrderNo: this.extractField(data, ['deliveryOrderNo', 'delivery_order_no', 'doNumber']),
      clientPoNumber: this.extractField(data, ['yourOrderNo', 'your_order_no', 'clientPoNumber', 'poReference']),
      
      // Payment
      paymentTerms: this.extractField(data, ['terms', 'paymentTerms', 'payment_terms']) || '30 DAYS',
      paymentTermsDays: this.extractPaymentDays(data),
      
      // Client
      clientName: this.extractClientName(data),
      clientAddress: this.extractClientAddress(data),
      
      // Company-specific fields
      remark: this.extractField(data, ['remark', 'remarks']),
      ourReference: this.extractField(data, ['ourReference', 'our_reference', 'reference']),
      accountNo: this.extractField(data, ['accountNo', 'account_no']),
      salesCode: this.extractField(data, ['salesCode', 'sales_code']),
      area: this.extractField(data, ['area']),
      
      // Items
      items: this.processLineItems(data),
      
      // Totals
      subtotal: this.extractAmount(data, ['subtotal', 'sub_total']),
      discount: this.extractAmount(data, ['discount']),
      tax: this.extractAmount(data, ['tax', 'gst', 'sst']),
      totalAmount: this.extractAmount(data, ['total', 'totalAmount', 'total_amount', 'grandTotal']),
      currency: this.extractField(data, ['currency']) || 'MYR',
      
      // Bank details based on company
      bankDetails: this.getBankDetails(companyFormat, data),
      
      // Company info
      companyName: this.getCompanyName(companyFormat),
      companyRegNo: this.getCompanyRegNo(companyFormat),
      
      // Status
      paymentStatus: 'pending',
      paidAmount: 0,
      
      // Metadata
      extractedAt: new Date().toISOString(),
      sourceFile: file?.originalname || 'unknown'
    };
    
    // Calculate due date if not provided
    if (!processed.dueDate && processed.invoiceDate && processed.paymentTermsDays > 0) {
      const invoiceDate = new Date(processed.invoiceDate);
      invoiceDate.setDate(invoiceDate.getDate() + processed.paymentTermsDays);
      processed.dueDate = invoiceDate.toISOString().split('T')[0];
    }
    
    return processed;
  }
  
  /**
   * Helper methods
   */
  extractField(data, keys) {
    for (const key of keys) {
      const value = data?.[key];
      if (value !== undefined && value !== null && value !== '') {
        return String(value).trim();
      }
    }
    return '';
  }
  
  extractAmount(data, keys) {
    for (const key of keys) {
      const value = data?.[key];
      if (value !== undefined && value !== null) {
        if (typeof value === 'number') return value;
        const cleaned = String(value).replace(/[RM$€£¥,\s]/gi, '').trim();
        const parsed = parseFloat(cleaned);
        if (!isNaN(parsed)) return parsed;
      }
    }
    return 0;
  }
  
  normalizeDate(dateStr) {
    if (!dateStr) return '';
    
    // DD/MM/YYYY to YYYY-MM-DD
    const ddmmyyyy = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (ddmmyyyy) {
      return `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`;
    }
    
    // Try parsing as date
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
    
    return dateStr;
  }
  
  extractPaymentDays(data) {
    const terms = this.extractField(data, ['terms', 'paymentTerms', 'payment_terms']);
    if (!terms) return 30;
    
    const match = terms.match(/(\d+)\s*(?:days?|d)/i);
    if (match) return parseInt(match[1], 10);
    
    const termsMap = {
      'cod': 0, 'cash': 0, 'net 30': 30, 'net 60': 60, 'net 90': 90,
      '30 days': 30, '60 days': 60, '90 days': 90, '120 days': 120
    };
    
    return termsMap[terms.toLowerCase()] || 30;
  }
  
  extractClientName(data) {
    const fields = ['clientName', 'client_name', 'customer', 'customerName', 'soldTo'];
    for (const field of fields) {
      if (data?.[field]) {
        if (typeof data[field] === 'object') {
          return data[field].name || data[field].companyName || '';
        }
        return String(data[field]).trim();
      }
    }
    return '';
  }
  
  extractClientAddress(data) {
    const address = this.extractField(data, ['clientAddress', 'client_address', 'address']);
    if (address) return address;
    
    const addressObj = data?.soldTo || data?.sold_to || data?.client || {};
    if (typeof addressObj === 'object' && addressObj.address) {
      return String(addressObj.address).trim();
    }
    
    return '';
  }
  
  processLineItems(data) {
    const items = data?.items || data?.lineItems || data?.line_items || data?.products || [];
    
    if (!Array.isArray(items)) return [];
    
    return items.map((item, index) => {
      const processed = {
        lineNumber: item.itemNumber || item.lineNumber || item.item || index + 1,
        productCode: String(item.productCode || item.product_code || item.itemCode || item.partNumber || '').trim(),
        description: String(item.description || item.desc || item.name || item.productName || '').trim(),
        quantity: parseFloat(item.quantity || item.qty || 1) || 1,
        unitPrice: parseFloat(String(item.unitPrice || item.unit_price || item.price || 0).replace(/[^0-9.-]/g, '')) || 0,
        amount: parseFloat(String(item.amount || item.total || item.totalPrice || 0).replace(/[^0-9.-]/g, '')) || 0,
        uom: String(item.uom || item.unit || 'PCS').trim(),
        jobCode: ''
      };
      
      // Detect job code in description
      processed.jobCode = this.detectJobCodeInText(processed.description);
      
      // Check item-level job code field
      if (!processed.jobCode && item.jobCode) {
        processed.jobCode = String(item.jobCode).toUpperCase().trim();
      }
      
      // Calculate amount if missing
      if (!processed.amount && processed.quantity && processed.unitPrice) {
        processed.amount = processed.quantity * processed.unitPrice;
      }
      
      return processed;
    });
  }
  
  /**
   * Detect job code pattern in text
   */
  detectJobCodeInText(text) {
    if (!text) return '';
    
    const patterns = [
      /\b(FS-[A-Z]?\d{3,5})\b/gi,      // Flow Solution
      /\b(BWS-[A-Z]?\d{3,5})\b/gi,     // Broadwater
      /\b(EMIT-[A-Z]?\d{3,5})\b/gi,    // EMI Technology
      /\b(EMI-[A-Z]?\d{3,5})\b/gi,     // EMI Automation
      /\b(HGF-[A-Z]?\d{3,5})\b/gi,     // HiggsFlow
      /\b([A-Z]{2,4}-[A-Z]?\d{3,5})\b/gi // Generic
    ];
    
    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        return matches[matches.length - 1].toUpperCase();
      }
    }
    
    return '';
  }
  
  /**
   * Detect all job codes from various locations
   */
  detectAllJobCodes(data) {
    const jobCodes = new Set();
    
    // From line items
    (data.items || []).forEach(item => {
      if (item.jobCode) jobCodes.add(item.jobCode.toUpperCase());
    });
    
    // From Remark field (Broadwater style)
    const remark = data.remark || '';
    const remarkCode = this.detectJobCodeInText(remark);
    if (remarkCode) jobCodes.add(remarkCode);
    
    // Direct remark as job code
    if (remark && /^[A-Z]{2,4}-[A-Z]?\d{3,5}$/i.test(remark.trim())) {
      jobCodes.add(remark.trim().toUpperCase());
    }
    
    // From Our Reference field (EMI style)
    const ourRef = data.ourReference || '';
    const refCode = this.detectJobCodeInText(ourRef);
    if (refCode) jobCodes.add(refCode);
    
    if (ourRef && /^[A-Z]{2,4}-[A-Z]?\d{3,5}$/i.test(ourRef.trim())) {
      jobCodes.add(ourRef.trim().toUpperCase());
    }
    
    return Array.from(jobCodes);
  }
  
  /**
   * Get bank details based on company format
   */
  getBankDetails(companyFormat, data) {
    const bankConfigs = {
      FLOW_SOLUTION: {
        beneficiary: 'FLOW SOLUTION SDN BHD',
        bankName: 'HONG LEONG ISLAMIC BANK',
        accountNumber: '17301010259',
        email: 'customerservice@flowsolution.net'
      },
      BROADWATER: {
        beneficiary: 'BROADWATER SOLUTION SDN BHD',
        bankName: 'MAYBANK',
        accountNumber: '514356535277',
        email: 'customerservice@broadwater.com.my'
      },
      EMI_TECHNOLOGY: {
        beneficiary: 'EMI TECHNOLOGY SDN BHD',
        bankName: 'HONG LEONG BANK',
        accountNumber: '22300066865',
        email: ''
      },
      EMI_AUTOMATION: {
        beneficiary: 'EMI AUTOMATION SDN BHD',
        bankName: 'UOB',
        accountNumber: '2203063786',
        email: 'info@emiautomation.com'
      }
    };
    
    return bankConfigs[companyFormat] || bankConfigs.FLOW_SOLUTION;
  }
  
  getCompanyName(companyFormat) {
    const names = {
      FLOW_SOLUTION: 'Flow Solution Sdn Bhd',
      BROADWATER: 'Broadwater Solution Sdn Bhd',
      EMI_TECHNOLOGY: 'EMI Technology Sdn Bhd',
      EMI_AUTOMATION: 'EMI Automation Sdn Bhd'
    };
    return names[companyFormat] || '';
  }
  
  getCompanyRegNo(companyFormat) {
    const regNos = {
      FLOW_SOLUTION: '402420-V',
      BROADWATER: '1302094-X',
      EMI_TECHNOLOGY: '',
      EMI_AUTOMATION: ''
    };
    return regNos[companyFormat] || '';
  }
}

module.exports = new ClientInvoiceController();
