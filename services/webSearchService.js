const axios = require('axios');
const cheerio = require('cheerio');

class WebSearchService {
  constructor() {
    this.serpApiKey = process.env.SERPAPI_KEY;
    this.timeout = 10000; // 10 seconds
  }

  /**
   * Main web search function for product information
   */
  async searchProductInfo(partNumber, brand = '', description = '') {
    try {
      console.log(`🔍 Starting web search for: ${partNumber}`);
      
      const searchMethods = [
        () => this.searchWithSerpAPI(partNumber, brand),
        () => this.searchWithDirectWebScraping(partNumber, brand),
        () => this.searchWithFallbackMethod(partNumber)
      ];

      for (const method of searchMethods) {
        try {
          const result = await method();
          if (result.found) {
            console.log(`✅ Web search successful: ${result.source}`);
            return result;
          }
        } catch (error) {
          console.warn(`⚠️ Search method failed:`, error.message);
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
    
    const response = await axios.get('https://serpapi.com/search', {
      params: {
        engine: 'google',
        q: query,
        api_key: this.serpApiKey,
        num: 10
      },
      timeout: this.timeout
    });

    const results = response.data.organic_results || [];
    
    if (results.length > 0) {
      const topResult = results[0];
      const extractedInfo = await this.extractProductInfoFromPage(topResult.link);
      
      return {
        found: true,
        source: 'SerpAPI Google Search',
        confidence: 0.8,
        productName: extractedInfo.productName || topResult.title,
        description: extractedInfo.description || topResult.snippet,
        specifications: extractedInfo.specifications || {},
        datasheetUrl: topResult.link,
        searchQuery: query
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
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        const $ = cheerio.load(response.data);
        const productInfo = site.extractor($, partNumber);
        
        if (productInfo.found) {
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
   * Fallback search using general web scraping
   */
  async searchWithFallbackMethod(partNumber) {
    // Simple DuckDuckGo search as fallback
    const searchUrl = `https://duckduckgo.com/html/?q="${partNumber}"+datasheet+specifications`;
    
    try {
      const response = await axios.get(searchUrl, {
        timeout: this.timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      const firstResult = $('.result__title a').first();
      
      if (firstResult.length > 0) {
        const title = firstResult.text().trim();
        const link = firstResult.attr('href');
        
        return {
          found: true,
          source: 'DuckDuckGo Fallback',
          confidence: 0.5,
          productName: title,
          description: `Product information for ${partNumber}`,
          datasheetUrl: link,
          specifications: {}
        };
      }
    } catch (error) {
      console.warn('Fallback search failed:', error.message);
    }

    throw new Error('Fallback search failed');
  }

  /**
   * Extract product information from webpage
   */
  async extractProductInfoFromPage(url) {
    try {
      const response = await axios.get(url, {
        timeout: this.timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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
        material: /(?:material|made of)[:\s]*([a-z\s]+)(?:\.|,|$)/i
      };

      Object.entries(specPatterns).forEach(([key, pattern]) => {
        const match = specText.match(pattern);
        if (match) {
          specifications[key] = match[1].trim();
        }
      });

      return {
        productName: productName.substring(0, 200), // Limit length
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
        searchUrl: 'https://mall.industry.siemens.com/search?q={partNumber}',
        extractor: ($, partNumber) => {
          const productCard = $('.product-card').first();
          if (productCard.length > 0) {
            return {
              found: true,
              productName: productCard.find('.product-title').text().trim(),
              description: productCard.find('.product-description').text().trim(),
              specifications: {}
            };
          }
          return { found: false };
        }
      },
      'ABB': {
        name: 'ABB',
        searchUrl: 'https://search.abb.com/library/Download.aspx?DocumentID={partNumber}',
        extractor: ($, partNumber) => {
          // ABB-specific extraction logic
          return { found: false };
        }
      },
      'SKF': {
        name: 'SKF',
        searchUrl: 'https://www.skf.com/us/products?query={partNumber}',
        extractor: ($, partNumber) => {
          // SKF-specific extraction logic
          return { found: false };
        }
      }
    };

    const brandUpper = brand.toUpperCase();
    return sites[brandUpper] ? [sites[brandUpper]] : [];
  }
}

module.exports = WebSearchService;
