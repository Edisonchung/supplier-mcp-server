// 🚀 Enhanced Category API Integration
// File: routes/categoryAPI.routes.js

const express = require('express');
const router = express.Router();
const { 
  findBestCategoryMatch, 
  generateDynamicCategory,
  hierarchicalCategories 
} = require('../utils/categoryManager');

// 🎯 ENHANCED PRODUCT ENHANCEMENT WITH SMART CATEGORIES
router.post('/api/enhance-product', async (req, res) => {
  try {
    const { productName, partNumber, description, brand, userEmail } = req.body;
    
    console.log('🎯 Enhanced Product Enhancement Request:', {
      productName,
      partNumber,
      userEmail,
      timestamp: new Date().toISOString()
    });

    // Call existing AI enhancement
    const aiEnhancement = await callAIEnhancement({
      productName,
      partNumber,
      description,
      brand
    });

    if (aiEnhancement.success) {
      // 🧠 Smart Category Processing
      const smartCategoryResult = await processSmartCategory(aiEnhancement.suggestions.category);
      
      // Enhance the response with smart category data
      const enhancedResponse = {
        ...aiEnhancement,
        suggestions: {
          ...aiEnhancement.suggestions,
          smartCategory: smartCategoryResult
        },
        categoryMapping: smartCategoryResult.mappingInfo,
        dynamicCategoryCreated: smartCategoryResult.dynamicCategory
      };

      // 📊 Log category analytics
      await logCategoryUsage({
        originalCategory: aiEnhancement.suggestions.category,
        mappedCategory: smartCategoryResult.finalCategory,
        confidence: smartCategoryResult.confidence,
        method: smartCategoryResult.method,
        userEmail,
        productName
      });

      res.json(enhancedResponse);
    } else {
      throw new Error(aiEnhancement.error || 'AI Enhancement failed');
    }

  } catch (error) {
    console.error('❌ Enhanced Product Enhancement Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      fallback: 'Smart category system temporarily unavailable'
    });
  }
});

// 🧠 SMART CATEGORY PROCESSING
async function processSmartCategory(aiSuggestedCategory) {
  if (!aiSuggestedCategory) {
    return {
      finalCategory: null,
      confidence: 0,
      method: 'no_suggestion',
      mappingInfo: null,
      dynamicCategory: null
    };
  }

  console.log('🧠 Processing smart category for:', aiSuggestedCategory);

  // Load available categories (in real app, this would be from database)
  const availableCategories = [
    'electronics', 'hydraulics', 'pneumatics', 'automation', 'sensors',
    'cables', 'components', 'mechanical', 'bearings', 'gears', 'couplings',
    'drives', 'instrumentation', 'networking', 'diaphragm_pumps',
    'pumping_systems', 'fluid_handling', 'pumps', 'valves', 'safety', 'electrical'
  ];

  try {
    // 1. Try to find best match
    const matchResult = findBestCategoryMatch(aiSuggestedCategory, availableCategories);
    
    if (matchResult && matchResult.confidence > 70) {
      return {
        finalCategory: matchResult.category,
        confidence: matchResult.confidence,
        method: matchResult.method,
        mappingInfo: {
          originalSuggestion: aiSuggestedCategory,
          mappedTo: matchResult.category,
          reason: `${matchResult.method} with ${matchResult.confidence}% confidence`
        },
        dynamicCategory: null
      };
    }

    // 2. Create dynamic category if no good match found
    const dynamicCategory = generateDynamicCategory(aiSuggestedCategory);
    
    if (dynamicCategory) {
      // Store dynamic category (in real app, save to database)
      await storeDynamicCategory(dynamicCategory);
      
      return {
        finalCategory: dynamicCategory.value,
        confidence: dynamicCategory.confidence,
        method: 'dynamic_creation',
        mappingInfo: {
          originalSuggestion: aiSuggestedCategory,
          dynamicCategoryCreated: true,
          reason: 'No suitable match found, created new category'
        },
        dynamicCategory: dynamicCategory
      };
    }

    // 3. Fallback to generic category
    return {
      finalCategory: 'components',
      confidence: 50,
      method: 'fallback',
      mappingInfo: {
        originalSuggestion: aiSuggestedCategory,
        fallbackUsed: true,
        reason: 'Could not match or create category, using fallback'
      },
      dynamicCategory: null
    };

  } catch (error) {
    console.error('❌ Smart category processing error:', error);
    return {
      finalCategory: 'components',
      confidence: 30,
      method: 'error_fallback',
      mappingInfo: {
        originalSuggestion: aiSuggestedCategory,
        error: error.message,
        reason: 'Error in processing, using fallback'
      },
      dynamicCategory: null
    };
  }
}

// 💾 STORE DYNAMIC CATEGORY
async function storeDynamicCategory(dynamicCategory) {
  try {
    // In a real application, this would save to database
    console.log('💾 Storing dynamic category:', dynamicCategory);
    
    // For now, we'll just log it
    // In production: await CategoryModel.create(dynamicCategory);
    
    return true;
  } catch (error) {
    console.error('❌ Error storing dynamic category:', error);
    return false;
  }
}

// 📊 LOG CATEGORY USAGE
async function logCategoryUsage(usageData) {
  try {
    const logEntry = {
      ...usageData,
      timestamp: new Date().toISOString(),
      id: Date.now()
    };

    console.log('📊 Category usage logged:', logEntry);
    
    // In production: await CategoryUsageModel.create(logEntry);
    return true;
  } catch (error) {
    console.error('❌ Error logging category usage:', error);
    return false;
  }
}

// 🎯 GET CATEGORY SUGGESTIONS ENDPOINT
router.get('/api/category-suggestions', async (req, res) => {
  try {
    const { query, limit = 10 } = req.query;
    
    if (!query) {
      return res.json({ suggestions: [] });
    }

    // Get suggestions from various sources
    const suggestions = await getCategorySuggestions(query, parseInt(limit));
    
    res.json({
      success: true,
      query,
      suggestions,
      totalFound: suggestions.length
    });

  } catch (error) {
    console.error('❌ Category suggestions error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 🔍 GET CATEGORY SUGGESTIONS
async function getCategorySuggestions(query, limit) {
  const suggestions = [];
  
  try {
    // 1. Search standard categories
    const standardCategories = [
      'electronics', 'hydraulics', 'pneumatics', 'automation', 'sensors',
      'cables', 'components', 'mechanical', 'bearings', 'gears', 'couplings',
      'drives', 'instrumentation', 'networking', 'diaphragm_pumps',
      'pumping_systems', 'fluid_handling', 'pumps', 'valves', 'safety', 'electrical'
    ];

    const queryLower = query.toLowerCase();
    standardCategories.forEach(category => {
      if (category.includes(queryLower)) {
        suggestions.push({
          value: category,
          label: category,
          type: 'standard',
          confidence: 90
        });
      }
    });

    // 2. Search hierarchical categories
    Object.entries(hierarchicalCategories).forEach(([mainCategory, data]) => {
      if (mainCategory.toLowerCase().includes(queryLower)) {
        suggestions.push({
          value: mainCategory.toLowerCase().replace(/[^a-z0-9]/g, '_'),
          label: `${data.icon} ${mainCategory}`,
          type: 'hierarchical_main',
          confidence: 85
        });
      }

      data.subcategories.forEach(subCategory => {
        if (subCategory.toLowerCase().includes(queryLower)) {
          suggestions.push({
            value: subCategory.toLowerCase().replace(/[^a-z0-9]/g, '_'),
            label: `${data.icon} ${mainCategory} > ${subCategory}`,
            type: 'hierarchical_sub',
            confidence: 95
          });
        }
      });
    });

    // 3. Generate AI suggestion if no good matches
    if (suggestions.length === 0) {
      const aiSuggestion = generateDynamicCategory(query);
      if (aiSuggestion) {
        suggestions.push({
          ...aiSuggestion,
          type: 'ai_generated'
        });
      }
    }

    // Sort by confidence and limit results
    return suggestions
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);

  } catch (error) {
    console.error('❌ Error getting category suggestions:', error);
    return [];
  }
}

// 📊 CATEGORY ANALYTICS ENDPOINT
router.get('/api/category-analytics', async (req, res) => {
  try {
    const { period = '30d', userEmail } = req.query;
    
    const analytics = await getCategoryAnalytics(period, userEmail);
    
    res.json({
      success: true,
      period,
      userEmail,
      analytics
    });

  } catch (error) {
    console.error('❌ Category analytics error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 📈 GET CATEGORY ANALYTICS
async function getCategoryAnalytics(period, userEmail) {
  try {
    // In a real app, this would query the database
    // For demo purposes, we'll return mock data
    
    return {
      totalCategorizations: 245,
      aiGeneratedCategories: 32,
      userCorrections: 18,
      mostUsedCategories: [
        { category: 'automation', count: 45, percentage: 18.4 },
        { category: 'electronics', count: 38, percentage: 15.5 },
        { category: 'drives', count: 29, percentage: 11.8 },
        { category: 'sensors', count: 22, percentage: 9.0 },
        { category: 'hydraulics', count: 19, percentage: 7.8 }
      ],
      aiAccuracyRate: 87.2,
      categoryMappingSuccess: 94.6,
      dynamicCategoriesCreated: 8,
      timeRange: {
        start: new Date(Date.now() - parsePeriod(period)).toISOString(),
        end: new Date().toISOString()
      }
    };

  } catch (error) {
    console.error('❌ Error getting category analytics:', error);
    return null;
  }
}

// 🔄 PARSE PERIOD HELPER
function parsePeriod(period) {
  const periodMap = {
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    '90d': 90 * 24 * 60 * 60 * 1000,
    '1y': 365 * 24 * 60 * 60 * 1000
  };
  
  return periodMap[period] || periodMap['30d'];
}

// 🤖 CALL AI ENHANCEMENT (Mock for now)
async function callAIEnhancement(productData) {
  // This would call your existing AI enhancement service
  // For demo, returning mock data
  
  return {
    success: true,
    suggestions: {
      productName: productData.productName || 'Enhanced Product Name',
      brand: productData.brand || 'AI-Detected Brand',
      category: 'Industrial Automation > Variable Frequency Drives (VFD)',
      description: 'AI-enhanced product description with technical specifications...',
      confidence: 92.3
    },
    processingTime: 2.1
  };
}

// 🏗️ CATEGORY HEALTH CHECK
router.get('/api/category-system-health', async (req, res) => {
  try {
    const healthCheck = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      services: {
        category_matching: 'operational',
        dynamic_category_creation: 'operational',
        ai_enhancement_integration: 'operational',
        category_analytics: 'operational'
      },
      statistics: {
        total_categories: 21,
        dynamic_categories: 8,
        ai_suggestions_pending: 3,
        mapping_success_rate: 94.6
      },
      version: '2.0.0'
    };

    res.json(healthCheck);

  } catch (error) {
    console.error('❌ Category system health check error:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
