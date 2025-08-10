// supplier-mcp-server/services/webSearchService.js
const axios = require('axios');
const cheerio = require('cheerio');

class WebSearchService {
  constructor() {
    this.serpApiKey = process.env.SERPAPI_KEY;
    this.timeout = 15000; // 15 seconds
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
  }

  /**
   * Main web search function for product information
   */
  async searchProductInfo(partNumber, brand = '', description = '') {
    try {
      console.log(`🔍 Starting web search for: ${partNumber} (Brand: ${brand})`);
      
      const searchMethods = [
        () => this.searchWithSerpAPI(partNumber, brand),
        () => this.searchWithDirectWebScraping(partNumber, brand),
        () => this.searchWithPuppeteer(partNumber, brand),
        () => this.searchWithFallbackMethod(partNumber)
      ];

      for (const [index, method] of searchMethods.entries()) {
        try {
          console.log(`🔍 Trying search method ${index + 1}...`);
          const result = await method();
          if (result.found) {
            console.log(`✅ Web search successful: ${result.source}`);
            return result;
          }
        } catch (error) {
          console.warn(`⚠️ Search method ${index + 1} failed:`, error.message);
        }
      }

      return { 
        found: false, 
        reason: 'No results found from any search method',
        source: 'web_search_service'
      };

    } catch (error) {
      console.error('🚫 Web search failed:', error);
      return { 
        found: false, 
        error: error.message,
        source: 'web_search_service_error'
      };
    }
  }

  /**
   * Search using SerpAPI (Google Search API)
   */
  async searchWithSerpAPI(partNumber, brand) {
    if (!this.serpApiKey) {
      throw new Error('SerpAPI key not configured');
    }

    const query = brand ? `"${partNumber}" ${brand} specifications datasheet` : `"${partNumber}" industrial component datasheet`;
    
    console.log(`🔍 SerpAPI search: ${query}`);
    
    const response = await axios.get('https://serpapi.com/search', {
      params: {
        engine: 'google',
        q: query,
        api_key: this.serpApiKey,
        num: 5,
        gl: 'us',
        hl: 'en'
      },
      timeout: this.timeout
    });

    const results = response.data.organic_results || [];
    
    if (results.length > 0) {
      const topResult = results[0];
      console.log(`✅ SerpAPI found result: ${topResult.title}`);
      
      const extractedInfo = await this.extractProductInfoFromPage(topResult.link);
      
      return {
        found: true,
        source: 'SerpAPI Google Search',
        confidence: 0.85,
        productName: extractedInfo.productName || topResult.title,
        description: extractedInfo.description || topResult.snippet,
        specifications: extractedInfo.specifications || {},
        datasheetUrl: topResult.link,
        searchQuery: query,
        additionalUrls: results.slice(1, 3).map(r => ({ title: r.title, url: r.link }))
      };
    }

    throw new Error('No SerpAPI results found');
  }

  /**
   * Direct web scraping for manufacturer websites
   */
  async searchWithDirectWebScraping(partNumber, brand) {
    const manufacturerSites = this.getManufacturerSites(brand);
    
    for (const site of manufacturerSites) {
      try {
        const searchUrl = site.searchUrl.replace('{partNumber}', encodeURIComponent(partNumber));
        console.log(`🔍 Searching ${site.name}: ${searchUrl}`);
        
        const response = await axios.get(searchUrl, {
          timeout: this.timeout,
          headers: {
            'User-Agent': this.userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive'
          }
        });

        const $ = cheerio.load(response.data);
        const productInfo = site.extractor($, partNumber);
        
        if (productInfo.found) {
          console.log(`✅ Direct scraping successful: ${site.name}`);
          return {
            found: true,
            source: `${site.name} Direct Search`,
            confidence: 0.9,
            ...productInfo
          };
        }
      } catch (error) {
        console.warn(`Failed to search ${site.name}:`, error.message);
      }
    }

    throw new Error('No direct scraping results found');
  }

  /**
   * Advanced search using Puppeteer for JavaScript-heavy sites
   */
  async searchWithPuppeteer(partNumber, brand) {
    let browser = null;
    
    try {
      const puppeteer = require('puppeteer');
      
      console.log(`🔍 Starting Puppeteer search for: ${partNumber}`);
      
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ]
      });

      const page = await browser.newPage();
      await page.setUserAgent(this.userAgent);
      
      // Search DuckDuckGo as it's more permissive
      const searchQuery = `"${partNumber}" ${brand || ''} specifications datasheet`;
      const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(searchQuery)}`;
      
      console.log(`🔍 Puppeteer navigating to: ${searchUrl}`);
      
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Wait for results to load
      await page.waitForSelector('[data-testid="result"]', { timeout: 10000 });
      
      // Extract search results
      const results = await page.evaluate(() => {
        const resultElements = document.querySelectorAll('[data-testid="result"]');
        const results = [];
        
        for (let i = 0; i < Math.min(resultElements.length, 3); i++) {
          const element = resultElements[i];
          const titleElement = element.querySelector('h2 a');
          const snippetElement = element.querySelector('[data-result="snippet"]');
          
          if (titleElement) {
            results.push({
              title: titleElement.textContent.trim(),
              url: titleElement.href,
              snippet: snippetElement ? snippetElement.textContent.trim() : ''
            });
          }
        }
        
        return results;
      });
      
      if (results.length > 0) {
        const topResult = results[0];
        console.log(`✅ Puppeteer found result: ${topResult.title}`);
        
        // Try to extract more detailed info from the top result
        const extractedInfo = await this.extractProductInfoWithPuppeteer(page, topResult.url);
        
        return {
          found: true,
          source: 'Puppeteer Web Search',
          confidence: 0.75,
          productName: extractedInfo.productName || topResult.title,
          description: extractedInfo.description || topResult.snippet,
          specifications: extractedInfo.specifications || {},
          datasheetUrl: topResult.url,
          searchQuery: searchQuery,
          additionalUrls: results.slice(1).map(r => ({ title: r.title, url: r.url }))
        };
      }

      throw new Error('No Puppeteer results found');
      
    } catch (error) {
      console.warn('Puppeteer search failed:', error.message);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Extract detailed product info using Puppeteer
   */
  async extractProductInfoWithPuppeteer(page, url) {
    try {
      console.log(`🔍 Extracting detailed info from: ${url}`);
      
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
      
      const extractedData = await page.evaluate(() => {
        // Extract title
        const productName = document.querySelector('h1')?.textContent?.trim() ||
                           document.querySelector('title')?.textContent?.trim() ||
                           'Product information found';

        // Extract description
        const description = document.querySelector('meta[name="description"]')?.getAttribute('content') ||
                           document.querySelector('.description')?.textContent?.trim() ||
                           document.querySelector('p')?.textContent?.trim() ||
                           'Product specifications available';

        // Extract specifications using common patterns
        const specifications = {};
        const pageText = document.body.textContent || '';
        
        // Common specification patterns
        const specPatterns = {
          voltage: /(?:voltage|volt)[:\s]*(\d+(?:\.\d+)?)\s*(?:v|volt)/i,
          dimensions: /(?:dimensions?|size)[:\s]*([0-9x\s\.]+(?:mm|cm|inch))/i,
          weight: /(?:weight|mass)[:\s]*([0-9\.]+\s*(?:kg|g|lb|oz))/i,
          material: /(?:material|made of)[:\s]*([a-z\s]+)(?:\.|,|$)/i,
          temperature: /(?:temperature|temp)[:\s]*(-?\d+(?:\.\d+)?)\s*(?:°|deg|degrees)?(?:c|f|celsius|fahrenheit)/i
        };

        Object.entries(specPatterns).forEach(([key, pattern]) => {
          const match = pageText.match(pattern);
          if (match) {
            specifications[key] = match[1].trim();
          }
        });

        return {
          productName: productName.substring(0, 200),
          description: description.substring(0, 500),
          specifications
        };
      });

      return extractedData;
      
    } catch (error) {
      console.warn('Failed to extract detailed info:', error.message);
      return {
        productName: '',
        description: '',
        specifications: {}
      };
    }
  }

  /**
   * Fallback search using general web scraping
   */
  async searchWithFallbackMethod(partNumber) {
    try {
      const searchUrl = `https://duckduckgo.com/html/?q="${partNumber}"+datasheet+specifications`;
      
      console.log(`🔍 Fallback search: ${searchUrl}`);
      
      const response = await axios.get(searchUrl, {
        timeout: this.timeout,
        headers: {
          'User-Agent': this.userAgent
        }
      });

      const $ = cheerio.load(response.data);
      const firstResult = $('.result__title a').first();
      
      if (firstResult.length > 0) {
        const title = firstResult.text().trim();
        const link = firstResult.attr('href');
        
        console.log(`✅ Fallback found result: ${title}`);
        
        return {
          found: true,
          source: 'DuckDuckGo Fallback',
          confidence: 0.6,
          productName: title,
          description: `Product information for ${partNumber}`,
          datasheetUrl: link,
          specifications: {},
          searchQuery: `"${partNumber}" datasheet specifications`
        };
      }
    } catch (error) {
      console.warn('Fallback search failed:', error.message);
    }

    throw new Error('Fallback search failed');
  }

  /**
   * Extract product information from webpage using Cheerio
   */
  async extractProductInfoFromPage(url) {
    try {
      console.log(`🔍 Extracting info from: ${url}`);
      
      const response = await axios.get(url, {
        timeout: this.timeout,
        headers: {
          'User-Agent': this.userAgent
        }
      });

      const $ = cheerio.load(response.data);
      
      // Extract title
      const productName = $('h1').first().text().trim() || 
                         $('title').text().trim() ||
                         'Product information found';

      // Extract description
      const description = $('meta[name="description"]').attr('content') ||
                         $('.description').first().text().trim() ||
                         $('p').first().text().trim() ||
                         'Product specifications available';

      // Extract specifications (basic pattern matching)
      const specifications = {};
      const specText = response.data;
      
      // Look for common specifications
      const specPatterns = {
        voltage: /(?:voltage|volt)[:\s]*(\d+(?:\.\d+)?)\s*(?:v|volt)/i,
        dimensions: /(?:dimensions?|size)[:\s]*([0-9x\s\.]+(?:mm|cm|inch))/i,
        weight: /(?:weight|mass)[:\s]*([0-9\.]+\s*(?:kg|g|lb|oz))/i,
        material: /(?:material|made of)[:\s]*([a-z\s]+)(?:\.|,|$)/i,
        temperature: /(?:temperature|temp)[:\s]*(-?\d+(?:\.\d+)?)\s*(?:°|deg|degrees)?(?:c|f)/i
      };

      Object.entries(specPatterns).forEach(([key, pattern]) => {
        const match = specText.match(pattern);
        if (match) {
          specifications[key] = match[1].trim();
        }
      });

      return {
        productName: productName.substring(0, 200),
        description: description.substring(0, 500),
        specifications
      };

    } catch (error) {
      console.warn('Failed to extract product info from page:', error.message);
      return {
        productName: '',
        description: '',
        specifications: {}
      };
    }
  }

  /**
   * Get manufacturer-specific search configurations
   */
  getManufacturerSites(brand) {
    const sites = {
      'SIEMENS': {
        name: 'Siemens',
        searchUrl: 'https://mall.industry.siemens.com/mall/en/WW/Catalog/Products?search={partNumber}',
        extractor: ($, partNumber) => {
          const productCard = $('.productTile, .product-item, .search-result-item').first();
          if (productCard.length > 0) {
            const title = productCard.find('h3, h4, .title, .product-title').first().text().trim();
            const description = productCard.find('.description, .product-description').first().text().trim();
            
            if (title && title.toLowerCase().includes(partNumber.toLowerCase())) {
              return {
                found: true,
                productName: title,
                description: description || `Siemens industrial component ${partNumber}`,
                specifications: { brand: 'Siemens', category: 'Industrial Automation' }
              };
            }
          }
          return { found: false };
        }
      },
      'ABB': {
        name: 'ABB',
        searchUrl: 'https://search.abb.com/library/Download.aspx?DocumentID={partNumber}',
        extractor: ($, partNumber) => {
          const resultItem = $('.search-result, .document-item').first();
          if (resultItem.length > 0) {
            return {
              found: true,
              productName: `ABB Component ${partNumber}`,
              description: resultItem.text().trim() || `ABB industrial component ${partNumber}`,
              specifications: { brand: 'ABB', category: 'Power and Automation' }
            };
          }
          return { found: false };
        }
      },
      'SKF': {
        name: 'SKF',
        searchUrl: 'https://www.skf.com/us/products?text={partNumber}',
        extractor: ($, partNumber) => {
          const productItem = $('.product-item, .search-result').first();
          if (productItem.length > 0) {
            const title = productItem.find('h3, h4, .title').first().text().trim();
            if (title && title.toLowerCase().includes(partNumber.toLowerCase())) {
              return {
                found: true,
                productName: title,
                description: `SKF bearing component ${partNumber}`,
                specifications: { brand: 'SKF', category: 'Bearings' }
              };
            }
          }
          return { found: false };
        }
      }
    };

    const brandUpper = brand?.toUpperCase();
    return brandUpper && sites[brandUpper] ? [sites[brandUpper]] : [];
  }
}

module.exports = WebSearchService;
