// controllers/clientInvoiceController.js
// Client Invoice Extraction Controller with VISION API support for scanned PDFs
// Handles both text-based and image-based (scanned) PDFs

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

class ClientInvoiceController {
  
  constructor() {
    // Check for OpenAI API key (for Vision)
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    
    // Minimum text length to consider PDF as text-based (not scanned)
    this.MIN_TEXT_LENGTH = 100;
  }

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
        size: file.size,
        hasBuffer: !!file.buffer,
        hasPath: !!file.path
      });
      
      // Extract user context
      const userContext = req.userContext || {
        email: req.body?.userEmail || req.body?.email || req.headers['x-user-email'] || 'anonymous',
        role: req.body?.role || 'user',
        uid: req.body?.uid || null
      };
      
      console.log('👤 User context:', userContext.email);
      
      // Detect company format from filename
      const companyFormat = this.detectCompanyFormat(file.originalname);
      console.log('🏢 Detected company format:', companyFormat);
      
      // Get PDF buffer
      let pdfBuffer;
      if (file.buffer) {
        pdfBuffer = file.buffer;
      } else if (file.path) {
        pdfBuffer = fs.readFileSync(file.path);
      } else {
        throw new Error('No file buffer or path available');
      }
      
      // Try to extract text from PDF first
      let pdfText = '';
      let isScannedPDF = false;
      
      try {
        const pdfData = await pdfParse(pdfBuffer);
        pdfText = pdfData.text || '';
        console.log('📖 PDF text extraction result:', {
          textLength: pdfText.length,
          pages: pdfData.numpages,
          preview: pdfText.substring(0, 200)
        });
        
        // If text is too short, it's likely a scanned PDF
        isScannedPDF = pdfText.trim().length < this.MIN_TEXT_LENGTH;
        
      } catch (parseError) {
        console.warn('⚠️ PDF text extraction failed:', parseError.message);
        isScannedPDF = true;
      }
      
      console.log('🔍 PDF type detected:', isScannedPDF ? 'SCANNED (image-based)' : 'TEXT-BASED');
      
      // Extract data using appropriate method
      let extractionResult;
      let extractionMethod;
      
      if (isScannedPDF) {
        // Use Vision API for scanned PDFs
        console.log('👁️ Using VISION API for scanned PDF extraction...');
        extractionResult = await this.extractWithVision(pdfBuffer, companyFormat, file.originalname);
        extractionMethod = 'vision_api';
      } else {
        // Use text-based extraction
        console.log('📝 Using TEXT-BASED extraction...');
        extractionResult = await this.extractFromText(pdfText, companyFormat);
        extractionMethod = 'text_extraction';
      }
      
      // Process and normalize the extracted data
      const processedData = this.processExtractedData(extractionResult, companyFormat, file);
      
      // Detect job codes from all locations
      const detectedJobCodes = this.detectAllJobCodes(processedData, file.originalname);
      processedData.detectedJobCodes = detectedJobCodes;
      processedData.linkedJobCodes = detectedJobCodes.map(jc => ({ id: jc, jobCode: jc }));
      processedData.jobCodes = detectedJobCodes;
      
      const processingTime = Date.now() - startTime;
      
      console.log('✅ ====== CLIENT INVOICE EXTRACTION COMPLETED ======');
      console.log('Processing time:', processingTime, 'ms');
      console.log('Extraction method:', extractionMethod);
      console.log('Invoice number:', processedData.invoiceNumber);
      console.log('Client name:', processedData.clientName);
      console.log('Detected job codes:', detectedJobCodes);
      console.log('Items extracted:', processedData.items?.length || 0);
      console.log('Total amount:', processedData.totalAmount);
      
      return res.json({
        success: true,
        data: processedData,
        extraction_metadata: {
          documentType: 'client_invoice',
          companyFormat: companyFormat,
          extractionMethod: extractionMethod,
          isScannedPDF: isScannedPDF,
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
   * Extract data from scanned PDF using Vision API
   */
  async extractWithVision(pdfBuffer, companyFormat, filename) {
    console.log('👁️ Starting Vision-based extraction...');
    
    // Convert PDF to base64 for Vision API
    const base64PDF = pdfBuffer.toString('base64');
    
    // Build the extraction prompt
    const extractionPrompt = this.buildExtractionPrompt(companyFormat, filename);
    
    // Try OpenAI GPT-4 Vision first
    if (this.openaiApiKey) {
      try {
        console.log('🤖 Calling OpenAI GPT-4 Vision...');
        return await this.callOpenAIVision(base64PDF, extractionPrompt);
      } catch (openaiError) {
        console.warn('⚠️ OpenAI Vision failed:', openaiError.message);
      }
    }
    
    // Fallback to Anthropic Claude Vision
    if (this.anthropicApiKey) {
      try {
        console.log('🤖 Calling Anthropic Claude Vision...');
        return await this.callAnthropicVision(base64PDF, extractionPrompt);
      } catch (anthropicError) {
        console.warn('⚠️ Anthropic Vision failed:', anthropicError.message);
      }
    }
    
    throw new Error('No Vision API available. Configure OPENAI_API_KEY or ANTHROPIC_API_KEY.');
  }

  /**
   * Call OpenAI GPT-4 Vision API
   */
  async callOpenAIVision(base64PDF, prompt) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.openaiApiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o', // GPT-4o has vision capabilities
        messages: [
          {
            role: 'system',
            content: 'You are an expert document extraction AI. Extract data from invoices accurately and return valid JSON only.'
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:application/pdf;base64,${base64PDF}`,
                  detail: 'high'
                }
              }
            ]
          }
        ],
        max_tokens: 4000,
        temperature: 0.1
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '';
    
    console.log('📥 OpenAI Vision response length:', content.length);
    
    return this.parseAIResponse(content);
  }

  /**
   * Call Anthropic Claude Vision API
   */
  async callAnthropicVision(base64PDF, prompt) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: base64PDF
                }
              },
              {
                type: 'text',
                text: prompt
              }
            ]
          }
        ]
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    const content = result.content?.[0]?.text || '';
    
    console.log('📥 Anthropic Vision response length:', content.length);
    
    return this.parseAIResponse(content);
  }

  /**
   * Extract data from text-based PDF using DeepSeek
   */
  async extractFromText(pdfText, companyFormat) {
    console.log('📝 Starting text-based extraction...');
    
    const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
    
    if (!DEEPSEEK_API_KEY) {
      // Fallback to basic regex extraction
      console.log('⚠️ No DEEPSEEK_API_KEY, using regex extraction');
      return this.extractWithRegex(pdfText, companyFormat);
    }
    
    const prompt = this.buildExtractionPrompt(companyFormat, '');
    
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
            content: prompt
          },
          {
            role: 'user',
            content: `Extract data from this invoice:\n\n${pdfText}`
          }
        ],
        temperature: 0.1,
        max_tokens: 3000
      })
    });
    
    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`);
    }
    
    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '';
    
    console.log('📥 DeepSeek response length:', content.length);
    
    return this.parseAIResponse(content);
  }

  /**
   * Build extraction prompt for AI
   */
  buildExtractionPrompt(companyFormat, filename) {
    return `Extract ALL data from this CLIENT INVOICE document and return ONLY valid JSON.

CRITICAL: This is an OUTGOING invoice FROM our company (${companyFormat}) TO a client.

=== JOB CODE DETECTION ===
Job codes appear in these locations:
- END of line item descriptions (e.g., "...brake motor. FS-S5054")
- REMARK field
- OUR REFERENCE field
- Filename: ${filename}

Job code pattern: 2-4 uppercase letters + hyphen + optional letter + 3-5 digits
Examples: FS-S5054, BWS-S1022, EMIT-S001, FS-S4659

=== EXTRACT THESE FIELDS ===

Return this EXACT JSON structure:
{
  "invoiceNumber": "string - the invoice number",
  "date": "string - invoice date in YYYY-MM-DD format",
  "dueDate": "string - due date if present",
  "deliveryOrderNo": "string - DO number",
  "yourOrderNo": "string - client's PO number reference",
  "terms": "string - payment terms",
  "remark": "string - remark field (may contain job code)",
  "ourReference": "string - our reference field",
  
  "clientName": "string - client/customer company name",
  "clientAddress": "string - client address",
  
  "items": [
    {
      "itemNumber": "number",
      "productCode": "string - part number or item code",
      "description": "string - full description including any job codes at the end",
      "quantity": "number",
      "uom": "string - unit of measure",
      "unitPrice": "number",
      "amount": "number"
    }
  ],
  
  "subtotal": "number",
  "discount": "number or 0",
  "tax": "number or 0",
  "total": "number - grand total",
  "currency": "string - default MYR",
  
  "bankDetails": {
    "beneficiary": "string",
    "bankName": "string",
    "accountNumber": "string"
  }
}

IMPORTANT:
1. Extract ALL line items, not just the first few
2. Look for job codes (like FS-S5054) at the END of item descriptions
3. Parse all numbers correctly (remove commas, handle decimals)
4. Convert dates to YYYY-MM-DD format
5. Return ONLY the JSON object, no markdown or explanation`;
  }

  /**
   * Parse AI response to extract JSON
   */
  parseAIResponse(content) {
    try {
      // Try to find JSON in the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          data: parsed,
          confidence: 0.9,
          provider: 'ai_vision'
        };
      }
    } catch (parseError) {
      console.warn('⚠️ Failed to parse JSON from AI response:', parseError.message);
    }
    
    // Return raw content if JSON parsing fails
    return {
      data: { rawContent: content },
      confidence: 0.5,
      provider: 'ai_vision'
    };
  }

  /**
   * Fallback regex extraction for text-based PDFs
   */
  extractWithRegex(pdfText, companyFormat) {
    console.log('🔍 Using regex extraction fallback...');
    
    const data = {};
    
    // Invoice number patterns
    const invMatch = pdfText.match(/(?:Invoice|INV)[\s#:]*([A-Z0-9-]+)/i);
    if (invMatch) data.invoiceNumber = invMatch[1];
    
    // Date patterns
    const dateMatch = pdfText.match(/(?:Date|Dated?)[\s:]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (dateMatch) data.date = dateMatch[1];
    
    // PO number
    const poMatch = pdfText.match(/(?:PO|P\.O\.|Purchase Order)[\s#:]*([A-Z0-9-]+)/i);
    if (poMatch) data.yourOrderNo = poMatch[1];
    
    // Total amount
    const totalMatch = pdfText.match(/(?:Total|Grand Total|Amount Due)[\s:]*(?:RM|MYR)?\s*([\d,]+\.?\d*)/i);
    if (totalMatch) data.total = parseFloat(totalMatch[1].replace(/,/g, ''));
    
    return {
      data: data,
      confidence: 0.4,
      provider: 'regex_fallback'
    };
  }

  /**
   * Detect company format from filename
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
    
    return 'FLOW_SOLUTION'; // Default
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
      
      // Items
      items: this.processLineItems(data),
      
      // Totals
      subtotal: this.extractAmount(data, ['subtotal', 'sub_total']),
      discount: this.extractAmount(data, ['discount']),
      tax: this.extractAmount(data, ['tax', 'gst', 'sst']),
      totalAmount: this.extractAmount(data, ['total', 'totalAmount', 'total_amount', 'grandTotal']),
      currency: this.extractField(data, ['currency']) || 'MYR',
      
      // Bank details
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
    const ddmmyyyy = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
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
    const fields = ['clientName', 'client_name', 'customer', 'customerName', 'soldTo', 'bill_to'];
    for (const field of fields) {
      if (data?.[field]) {
        if (typeof data[field] === 'object') {
          return data[field].name || data[field].companyName || data[field].company || '';
        }
        return String(data[field]).trim();
      }
    }
    return '';
  }
  
  extractClientAddress(data) {
    const address = this.extractField(data, ['clientAddress', 'client_address', 'address']);
    if (address) return address;
    
    const addressObj = data?.soldTo || data?.sold_to || data?.client || data?.bill_to || {};
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
   * Detect all job codes from various locations including filename
   */
  detectAllJobCodes(data, filename) {
    const jobCodes = new Set();
    
    // From filename (e.g., "PTP INV 059784 PO-024080 S4659.pdf")
    const filenameMatch = filename.match(/S(\d{4,5})/gi);
    if (filenameMatch) {
      filenameMatch.forEach(match => {
        const code = `FS-${match.toUpperCase()}`;
        jobCodes.add(code);
      });
    }
    
    // From line items
    (data.items || []).forEach(item => {
      if (item.jobCode) jobCodes.add(item.jobCode.toUpperCase());
    });
    
    // From Remark field
    const remark = data.remark || '';
    const remarkCode = this.detectJobCodeInText(remark);
    if (remarkCode) jobCodes.add(remarkCode);
    
    // Direct remark as job code
    if (remark && /^[A-Z]{2,4}-[A-Z]?\d{3,5}$/i.test(remark.trim())) {
      jobCodes.add(remark.trim().toUpperCase());
    }
    
    // From Our Reference field
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
    // Check if bank details were extracted from the document
    if (data?.bankDetails && typeof data.bankDetails === 'object') {
      const extracted = data.bankDetails;
      if (extracted.accountNumber || extracted.bankName) {
        return {
          beneficiary: extracted.beneficiary || '',
          bankName: extracted.bankName || '',
          accountNumber: extracted.accountNumber || '',
          email: extracted.email || ''
        };
      }
    }
    
    // Default bank configs per company
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
