// controllers/clientInvoiceController.js
// Client Invoice Extraction Controller with VISION API support for scanned PDFs

const fs = require('fs');
const pdfParse = require('pdf-parse');

class ClientInvoiceController {
  
  constructor() {
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    this.MIN_TEXT_LENGTH = 100;
  }

  async extractFromPDF(req, res) {
    const startTime = Date.now();
    
    console.log('🧾 ====== CLIENT INVOICE EXTRACTION STARTED ======');
    
    try {
      const file = req.file;
      if (!file) {
        console.error('❌ No file provided');
        return res.status(400).json({ success: false, error: 'No file provided', code: 'NO_FILE' });
      }
      
      console.log('📄 Processing:', file.originalname, 'Size:', file.size);
      
      const userContext = req.userContext || {
        email: req.body?.userEmail || req.headers['x-user-email'] || 'anonymous'
      };
      
      const companyFormat = this.detectCompanyFormat(file.originalname);
      console.log('🏢 Company format:', companyFormat);
      
      // Get PDF buffer
      let pdfBuffer;
      if (file.buffer) {
        pdfBuffer = file.buffer;
      } else if (file.path) {
        pdfBuffer = fs.readFileSync(file.path);
      } else {
        throw new Error('No file buffer or path available');
      }
      
      // Try text extraction first
      let pdfText = '';
      let isScannedPDF = false;
      
      try {
        const pdfData = await pdfParse(pdfBuffer);
        pdfText = pdfData.text || '';
        console.log('📖 PDF text length:', pdfText.length, 'Pages:', pdfData.numpages);
        isScannedPDF = pdfText.trim().length < this.MIN_TEXT_LENGTH;
      } catch (parseError) {
        console.warn('⚠️ PDF parse failed:', parseError.message);
        isScannedPDF = true;
      }
      
      console.log('🔍 PDF type:', isScannedPDF ? 'SCANNED' : 'TEXT-BASED');
      
      let extractionResult;
      let extractionMethod;
      
      if (isScannedPDF) {
        console.log('👁️ Using Vision API...');
        extractionResult = await this.extractWithVision(pdfBuffer, companyFormat, file.originalname);
        extractionMethod = 'vision_api';
      } else {
        console.log('📝 Using text extraction...');
        extractionResult = await this.extractFromText(pdfText, companyFormat);
        extractionMethod = 'text_extraction';
      }
      
      const processedData = this.processExtractedData(extractionResult, companyFormat, file);
      const detectedJobCodes = this.detectAllJobCodes(processedData, file.originalname);
      processedData.detectedJobCodes = detectedJobCodes;
      processedData.linkedJobCodes = detectedJobCodes.map(jc => ({ id: jc, jobCode: jc }));
      processedData.jobCodes = detectedJobCodes;
      
      const processingTime = Date.now() - startTime;
      
      console.log('✅ EXTRACTION COMPLETE');
      console.log('Invoice:', processedData.invoiceNumber);
      console.log('Client:', processedData.clientName);
      console.log('Items:', processedData.items?.length || 0);
      console.log('Total:', processedData.totalAmount);
      console.log('Job codes:', detectedJobCodes);
      console.log('Time:', processingTime, 'ms');
      
      return res.json({
        success: true,
        data: processedData,
        extraction_metadata: {
          documentType: 'client_invoice',
          companyFormat,
          extractionMethod,
          isScannedPDF,
          processingTime,
          confidence: extractionResult.confidence || 0.85,
          jobCodesDetected: detectedJobCodes.length,
          itemsExtracted: processedData.items?.length || 0,
          userEmail: userContext.email,
          timestamp: new Date().toISOString()
        }
      });
      
    } catch (error) {
      console.error('❌ Extraction failed:', error.message);
      console.error(error.stack);
      return res.status(500).json({
        success: false,
        error: 'Client invoice extraction failed',
        details: error.message
      });
    }
  }

  async extractWithVision(pdfBuffer, companyFormat, filename) {
    const base64PDF = pdfBuffer.toString('base64');
    const prompt = this.buildExtractionPrompt(companyFormat, filename);
    
    if (this.openaiApiKey) {
      try {
        console.log('🤖 Calling OpenAI GPT-4o Vision...');
        return await this.callOpenAIVision(base64PDF, prompt);
      } catch (err) {
        console.warn('⚠️ OpenAI failed:', err.message);
      }
    }
    
    if (this.anthropicApiKey) {
      try {
        console.log('🤖 Calling Anthropic Claude Vision...');
        return await this.callAnthropicVision(base64PDF, prompt);
      } catch (err) {
        console.warn('⚠️ Anthropic failed:', err.message);
      }
    }
    
    throw new Error('No Vision API available. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.');
  }

  async callOpenAIVision(base64PDF, prompt) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.openaiApiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'Extract invoice data and return valid JSON only.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:application/pdf;base64,${base64PDF}`, detail: 'high' } }
            ]
          }
        ],
        max_tokens: 4000,
        temperature: 0.1
      })
    });
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI error: ${response.status} - ${errText}`);
    }
    
    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '';
    console.log('📥 OpenAI response length:', content.length);
    return this.parseAIResponse(content);
  }

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
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64PDF } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic error: ${response.status} - ${errText}`);
    }
    
    const result = await response.json();
    const content = result.content?.[0]?.text || '';
    console.log('📥 Anthropic response length:', content.length);
    return this.parseAIResponse(content);
  }

  async extractFromText(pdfText, companyFormat) {
    const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
    if (!DEEPSEEK_API_KEY) {
      return this.extractWithRegex(pdfText);
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
          { role: 'system', content: prompt },
          { role: 'user', content: `Extract from this invoice:\n\n${pdfText}` }
        ],
        temperature: 0.1,
        max_tokens: 3000
      })
    });
    
    if (!response.ok) throw new Error(`DeepSeek error: ${response.status}`);
    
    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '';
    return this.parseAIResponse(content);
  }

  buildExtractionPrompt(companyFormat, filename) {
    return `Extract ALL data from this CLIENT INVOICE and return ONLY valid JSON.

Company: ${companyFormat}
Filename: ${filename}

Job codes appear at END of descriptions or in REMARK/REFERENCE fields.
Pattern: 2-4 letters + hyphen + optional letter + 3-5 digits (e.g., FS-S5054, BWS-S1022)

Return this JSON:
{
  "invoiceNumber": "string",
  "date": "YYYY-MM-DD",
  "yourOrderNo": "client PO number",
  "terms": "payment terms",
  "remark": "may contain job code",
  "clientName": "company name",
  "clientAddress": "address",
  "items": [{"itemNumber": 1, "productCode": "", "description": "", "quantity": 1, "unitPrice": 0, "amount": 0}],
  "subtotal": 0,
  "tax": 0,
  "total": 0,
  "currency": "MYR",
  "bankDetails": {"beneficiary": "", "bankName": "", "accountNumber": ""}
}

Extract ALL items. Parse numbers correctly. Return ONLY JSON.`;
  }

  parseAIResponse(content) {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { data: JSON.parse(jsonMatch[0]), confidence: 0.9, provider: 'ai' };
      }
    } catch (e) {
      console.warn('⚠️ JSON parse failed:', e.message);
    }
    return { data: { rawContent: content }, confidence: 0.5, provider: 'ai' };
  }

  extractWithRegex(pdfText) {
    const data = {};
    const invMatch = pdfText.match(/(?:Invoice|INV)[\s#:]*([A-Z0-9-]+)/i);
    if (invMatch) data.invoiceNumber = invMatch[1];
    const totalMatch = pdfText.match(/(?:Total|Grand Total)[\s:]*(?:RM|MYR)?\s*([\d,]+\.?\d*)/i);
    if (totalMatch) data.total = parseFloat(totalMatch[1].replace(/,/g, ''));
    return { data, confidence: 0.4, provider: 'regex' };
  }

  detectCompanyFormat(filename) {
    const name = (filename || '').toLowerCase();
    if (name.includes('bws')) return 'BROADWATER';
    if (name.includes('emit-')) return 'EMI_TECHNOLOGY';
    if (name.includes('emi-inv')) return 'EMI_AUTOMATION';
    return 'FLOW_SOLUTION';
  }

  processExtractedData(extractionResult, companyFormat, file) {
    const data = extractionResult.data || {};
    return {
      documentType: 'client_invoice',
      companyFormat,
      invoiceNumber: data.invoiceNumber || data.invoice_number || '',
      invoiceDate: this.normalizeDate(data.date || data.invoiceDate || ''),
      dueDate: this.normalizeDate(data.dueDate || ''),
      deliveryOrderNo: data.deliveryOrderNo || '',
      clientPoNumber: data.yourOrderNo || data.poNumber || '',
      paymentTerms: data.terms || '30 DAYS',
      paymentTermsDays: 30,
      clientName: data.clientName || data.customer || '',
      clientAddress: data.clientAddress || '',
      remark: data.remark || '',
      ourReference: data.ourReference || '',
      items: this.processLineItems(data),
      subtotal: parseFloat(data.subtotal) || 0,
      discount: parseFloat(data.discount) || 0,
      tax: parseFloat(data.tax) || 0,
      totalAmount: parseFloat(data.total || data.totalAmount) || 0,
      currency: data.currency || 'MYR',
      bankDetails: this.getBankDetails(companyFormat, data),
      companyName: this.getCompanyName(companyFormat),
      paymentStatus: 'pending',
      paidAmount: 0,
      extractedAt: new Date().toISOString(),
      sourceFile: file?.originalname || ''
    };
  }

  processLineItems(data) {
    const items = data?.items || [];
    if (!Array.isArray(items)) return [];
    return items.map((item, idx) => ({
      lineNumber: item.itemNumber || idx + 1,
      productCode: String(item.productCode || '').trim(),
      description: String(item.description || '').trim(),
      quantity: parseFloat(item.quantity || 1) || 1,
      unitPrice: parseFloat(String(item.unitPrice || 0).replace(/[^0-9.-]/g, '')) || 0,
      amount: parseFloat(String(item.amount || 0).replace(/[^0-9.-]/g, '')) || 0,
      uom: item.uom || 'PCS',
      jobCode: this.detectJobCodeInText(item.description || '')
    }));
  }

  normalizeDate(dateStr) {
    if (!dateStr) return '';
    const match = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    return dateStr;
  }

  detectJobCodeInText(text) {
    if (!text) return '';
    const match = text.match(/\b([A-Z]{2,4}-[A-Z]?\d{3,5})\b/i);
    return match ? match[1].toUpperCase() : '';
  }

  detectAllJobCodes(data, filename) {
    const codes = new Set();
    const fnMatch = filename.match(/S(\d{4,5})/gi);
    if (fnMatch) fnMatch.forEach(m => codes.add(`FS-${m.toUpperCase()}`));
    (data.items || []).forEach(item => { if (item.jobCode) codes.add(item.jobCode.toUpperCase()); });
    const remarkCode = this.detectJobCodeInText(data.remark || '');
    if (remarkCode) codes.add(remarkCode);
    return Array.from(codes);
  }

  getBankDetails(companyFormat, data) {
    if (data?.bankDetails?.accountNumber) return data.bankDetails;
    const banks = {
      FLOW_SOLUTION: { beneficiary: 'FLOW SOLUTION SDN BHD', bankName: 'HONG LEONG ISLAMIC BANK', accountNumber: '17301010259' },
      BROADWATER: { beneficiary: 'BROADWATER SOLUTION SDN BHD', bankName: 'MAYBANK', accountNumber: '514356535277' },
      EMI_TECHNOLOGY: { beneficiary: 'EMI TECHNOLOGY SDN BHD', bankName: 'HONG LEONG BANK', accountNumber: '22300066865' },
      EMI_AUTOMATION: { beneficiary: 'EMI AUTOMATION SDN BHD', bankName: 'UOB', accountNumber: '2203063786' }
    };
    return banks[companyFormat] || banks.FLOW_SOLUTION;
  }

  getCompanyName(format) {
    const names = { FLOW_SOLUTION: 'Flow Solution Sdn Bhd', BROADWATER: 'Broadwater Solution Sdn Bhd', EMI_TECHNOLOGY: 'EMI Technology Sdn Bhd', EMI_AUTOMATION: 'EMI Automation Sdn Bhd' };
    return names[format] || '';
  }
}

module.exports = new ClientInvoiceController();
