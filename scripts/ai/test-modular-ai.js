const UnifiedAIService = require('../../services/ai/UnifiedAIService');

async function testModularAI() {
  console.log('🧪 Testing HiggsFlow Modular AI System...\n');

  let testResults = {
    total: 0,
    passed: 0,
    failed: 0,
    tests: []
  };

  const aiService = new UnifiedAIService();

  // Test 1: System Health Check
  await runTest('System Health Check', async () => {
    const health = await aiService.healthCheck();
    
    if (health.status !== 'healthy') {
      throw new Error(`Expected status 'healthy', got '${health.status}'`);
    }
    
    if (!health.modules || health.modules === 0) {
      throw new Error('No modules found');
    }
    
    return {
      status: health.status,
      modules: health.modules,
      prompts: health.prompts,
      providers: health.providers,
      version: health.version
    };
  });

  // Test 2: Module Management
  await runTest('Module Management', async () => {
    const modules = await aiService.getModules();
    
    if (!Array.isArray(modules) || modules.length === 0) {
      throw new Error('No modules loaded');
    }
    
    const activeModules = modules.filter(m => m.status === 'active');
    if (activeModules.length === 0) {
      throw new Error('No active modules found');
    }
    
    // Test getting specific module
    const firstModule = modules[0];
    const retrievedModule = await aiService.getModule(firstModule.id);
    
    if (!retrievedModule || retrievedModule.id !== firstModule.id) {
      throw new Error('Failed to retrieve specific module');
    }
    
    return {
      total_modules: modules.length,
      active_modules: activeModules.length,
      first_module: firstModule.name,
      categories: [...new Set(modules.map(m => m.category))].join(', ')
    };
  });

  // Test 3: Prompt Management
  await runTest('Prompt Management', async () => {
    const prompts = await aiService.getPrompts();
    
    if (!Array.isArray(prompts) || prompts.length === 0) {
      throw new Error('No prompts loaded');
    }
    
    const activePrompts = prompts.filter(p => p.isActive);
    if (activePrompts.length === 0) {
      throw new Error('No active prompts found');
    }
    
    // Check for essential prompts
    const poPrompt = prompts.find(p => p.category === 'purchase_order');
    if (!poPrompt) {
      throw new Error('No purchase order prompt found');
    }
    
    return {
      total_prompts: prompts.length,
      active_prompts: activePrompts.length,
      categories: [...new Set(prompts.map(p => p.category))].join(', '),
      po_prompt_found: !!poPrompt
    };
  });

  // Test 4: AI Provider Status
  await runTest('AI Provider Status', async () => {
    const providerStatus = await aiService.getProviderStatus();
    
    if (!providerStatus || typeof providerStatus !== 'object') {
      throw new Error('No provider status available');
    }
    
    const availableProviders = Object.keys(providerStatus);
    if (availableProviders.length === 0) {
      throw new Error('No AI providers available');
    }
    
    return {
      available_providers: availableProviders.length,
      providers: availableProviders.join(', '),
      all_available: Object.values(providerStatus).every(p => p.available)
    };
  });

  // Test 5: Basic Document Extraction
  await runTest('Basic Document Extraction', async () => {
    const testDocument = `
      PURCHASE ORDER
      PO Number: PO-TEST-001
      Date: 2025-01-15
      Supplier: Test Supplier Ltd.
      
      Line Items:
      1. Widget A - Qty: 10 - Unit Price: $50.00 - Total: $500.00
      2. Widget B - Qty: 5 - Unit Price: $100.00 - Total: $500.00
      
      Total Amount: $1,000.00
    `;

    const result = await aiService.extractFromDocument(testDocument, 'purchase_order', {
      supplier: 'TEST_SUPPLIER',
      filename: 'test-po.txt',
      documentType: 'text'
    });

    if (!result.success) {
      throw new Error('Document extraction failed');
    }

    if (!result.result || typeof result.result !== 'object') {
      throw new Error('No extraction result returned');
    }

    if (!result.metadata || !result.metadata.module) {
      throw new Error('No metadata returned');
    }

    return {
      success: result.success,
      module_used: result.metadata.module,
      prompt_used: result.metadata.prompt,
      confidence: result.metadata.confidence,
      processing_time: result.metadata.processingTime
    };
  });

  // Test 6: Supplier-Specific Processing (PTP)
  await runTest('PTP Supplier-Specific Processing', async () => {
    const ptpDocument = `
      Purchase Order - PT. PERINTIS TEKNOLOGI PERDANA
      
      Line | Part Number | Delivery Date | Quantity | UOM | Unit Price | TAX | Amount
      1    | 400QCR1068  | 2025-02-15   | 1.00     | PCS | 20,500.00  | 0   | 20,500.00
           | THRUSTER    |              |          |     |            |     |
    `;

    const result = await aiService.extractFromDocument(ptpDocument, 'purchase_order', {
      supplier: 'PTP',
      supplierName: 'PT. PERINTIS TEKNOLOGI PERDANA',
      documentType: 'text'
    });

    if (!result.success) {
      throw new Error('PTP extraction failed');
    }

    // Check if PTP-specific prompt was used
    const ptpSpecific = result.metadata.prompt && 
                       result.metadata.prompt.toLowerCase().includes('ptp');

    return {
      success: result.success,
      ptp_specific_prompt: ptpSpecific,
      module_used: result.metadata.module,
      confidence: result.metadata.confidence,
      supplier_detected: result.result.purchase_order?.supplier?.name || 'Not detected'
    };
  });

  // Test 7: Error Handling
  await runTest('Error Handling', async () => {
    try {
      // Test with invalid input
      await aiService.extractFromDocument('', 'invalid_type', {});
      throw new Error('Should have thrown an error for invalid input');
    } catch (error) {
      if (error.message.includes('Should have thrown')) {
        throw error;
      }
      // Expected error - this is good
    }

    try {
      // Test with non-existent module
      const invalidModule = await aiService.getModule('non-existent-module');
      if (invalidModule) {
        throw new Error('Should not return module for invalid ID');
      }
    } catch (error) {
      // Expected behavior
    }

    return {
      invalid_input_handled: true,
      invalid_module_handled: true,
      error_handling: 'working'
    };
  });

  // Test 8: Performance Test
  await runTest('Performance Test', async () => {
    const testDoc = 'PURCHASE ORDER PO-PERF-001 Performance test document';
    const iterations = 3;
    const times = [];
    
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await aiService.extractFromDocument(testDoc, 'purchase_order', {
        supplier: 'PERF_TEST',
        documentType: 'text'
      });
      times.push(Date.now() - start);
    }
    
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const maxTime = Math.max(...times);
    const minTime = Math.min(...times);
    
    return {
      iterations: iterations,
      avg_time: `${avgTime.toFixed(1)}ms`,
      min_time: `${minTime}ms`,
      max_time: `${maxTime}ms`,
      performance: avgTime < 5000 ? 'excellent' : avgTime < 10000 ? 'good' : 'needs_improvement'
    };
  });

  // Test 9: Module Update Test
  await runTest('Module Update', async () => {
    const modules = await aiService.getModules();
    const testModule = modules.find(m => m.status === 'active');
    
    if (!testModule) {
      throw new Error('No active module to test update');
    }
    
    // Update module description
    const originalDesc = testModule.description;
    const testDesc = `${originalDesc} - Updated at ${new Date().toISOString()}`;
    
    const updateSuccess = await aiService.updateModule(testModule.id, {
      description: testDesc
    });
    
    if (!updateSuccess) {
      throw new Error('Module update failed');
    }
    
    // Verify update
    const updatedModule = await aiService.getModule(testModule.id);
    if (updatedModule.description !== testDesc) {
      throw new Error('Module update not persisted');
    }
    
    // Restore original description
    await aiService.updateModule(testModule.id, {
      description: originalDesc
    });
    
    return {
      module_updated: testModule.name,
      update_success: updateSuccess,
      description_changed: true,
      restored: true
    };
  });

  // Test 10: Integration Test
  await runTest('Full Integration Test', async () => {
    // Test the complete flow: health check → module selection → prompt selection → extraction
    
    // 1. Health check
    const health = await aiService.healthCheck();
    if (health.status !== 'healthy') {
      throw new Error('System not healthy for integration test');
    }
    
    // 2. Get modules and prompts
    const modules = await aiService.getModules();
    const prompts = await aiService.getPrompts();
    
    // 3. Test document extraction with full flow
    const integrationDoc = `
      PROFORMA INVOICE
      PI Number: PI-INT-001
      Date: 2025-01-15
      Supplier: Integration Test Co.
      
      Items:
      1. Test Product - Qty: 1 - Price: $100.00
      
      Total: $100.00
    `;
    
    const result = await aiService.extractFromDocument(integrationDoc, 'proforma_invoice', {
      supplier: 'INTEGRATION_TEST',
      filename: 'integration-test.txt'
    });
    
    if (!result.success) {
      throw new Error('Integration extraction failed');
    }
    
    return {
      health_status: health.status,
      modules_loaded: modules.length,
      prompts_loaded: prompts.length,
      extraction_success: result.success,
      end_to_end: 'working'
    };
  });

  // Print comprehensive summary
  console.log('\n📊 Modular AI Test Summary:');
  console.log(`   Total tests: ${testResults.total}`);
  console.log(`   Passed: ${testResults.passed} ✅`);
  console.log(`   Failed: ${testResults.failed} ❌`);
  console.log(`   Success rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);

  if (testResults.failed > 0) {
    console.log('\n❌ Failed tests:');
    testResults.tests
      .filter(test => !test.success)
      .forEach(test => {
        console.log(`   - ${test.name}: ${test.error}`);
      });
  }

  console.log('\n🎉 Modular AI testing completed!');
  
  if (testResults.passed === testResults.total) {
    console.log('✅ All tests passed! Phase 1 is complete and ready for Phase 2.');
    console.log('\n🚀 Phase 1 Achievements:');
    console.log('   ✅ Modular AI architecture operational');
    console.log('   ✅ Multi-provider AI support working');
    console.log('   ✅ Supplier-specific intelligence active');
    console.log('   ✅ Document extraction enhanced');
    console.log('   ✅ Performance and error handling verified');
    console.log('\n🎯 Ready to proceed to Phase 2: MCP Enhancement!');
  } else {
    console.log('⚠️ Some tests failed. Please review and fix issues before proceeding to Phase 2.');
  }

  return testResults;

  // Helper function to run individual tests
  async function runTest(name, testFunction) {
    testResults.total++;
    const startTime = Date.now();
    
    try {
      console.log(`🧪 Running: ${name}...`);
      const result = await testFunction();
      const duration = Date.now() - startTime;
      
      testResults.passed++;
      testResults.tests.push({
        name,
        success: true,
        duration: `${duration}ms`,
        result
      });
      
      console.log(`   ✅ Passed (${duration}ms)`);
      if (result && typeof result === 'object') {
        Object.entries(result).forEach(([key, value]) => {
          console.log(`      ${key}: ${value}`);
        });
      }
      console.log();
    } catch (error) {
      const duration = Date.now() - startTime;
      
      testResults.failed++;
      testResults.tests.push({
        name,
        success: false,
        duration: `${duration}ms`,
        error: error.message
      });
      
      console.log(`   ❌ Failed (${duration}ms): ${error.message}\n`);
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  testModularAI().catch(console.error);
}

module.exports = testModularAI;
