// 🔥 Firestore Category Management Backend Implementation
// Add to your existing MCP server

const { 
  collection, 
  doc, 
  getDocs, 
  getDoc,
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy,
  serverTimestamp,
  writeBatch
} = require('firebase/firestore');
const { db } = require('../firebase'); // Your existing Firebase config

// ================================================================
// FIRESTORE CATEGORY ROUTES - Add to routes/categories.routes.js
// ================================================================

const express = require('express');
const router = express.Router();

// Helper function to generate category ID from name
const generateCategoryId = (name) => {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '_');
};

// Get all categories
router.get('/categories', async (req, res) => {
  try {
    console.log('📁 Loading categories from Firestore...');
    
    const categoriesRef = collection(db, 'categories');
    const q = query(
      categoriesRef, 
      where('isActive', '==', true),
      orderBy('sortOrder', 'asc'),
      orderBy('name', 'asc')
    );
    
    const snapshot = await getDocs(q);
    const categories = [];
    
    for (const docSnap of snapshot.docs) {
      const categoryData = { id: docSnap.id, ...docSnap.data() };
      
      // Count prompts in this category
      try {
        const promptsRef = collection(db, 'prompts');
        const promptQuery = query(promptsRef, where('category', '==', docSnap.id));
        const promptSnapshot = await getDocs(promptQuery);
        categoryData.promptCount = promptSnapshot.size;
      } catch (error) {
        console.warn(`Failed to count prompts for category ${docSnap.id}:`, error);
        categoryData.promptCount = 0;
      }
      
      // Convert Firestore timestamps to ISO strings
      if (categoryData.createdAt && categoryData.createdAt.toDate) {
        categoryData.createdAt = categoryData.createdAt.toDate().toISOString();
      }
      if (categoryData.updatedAt && categoryData.updatedAt.toDate) {
        categoryData.updatedAt = categoryData.updatedAt.toDate().toISOString();
      }
      if (categoryData.lastUsed && categoryData.lastUsed.toDate) {
        categoryData.lastUsed = categoryData.lastUsed.toDate().toISOString();
      }
      
      categories.push(categoryData);
    }
    
    console.log(`✅ Loaded ${categories.length} categories from Firestore`);
    res.json(categories);
    
  } catch (error) {
    console.error('❌ Failed to load categories from Firestore:', error);
    res.status(500).json({ 
      error: 'Failed to load categories',
      details: error.message 
    });
  }
});

// Create new category
router.post('/categories', async (req, res) => {
  try {
    const { name, description, color, icon, userEmail } = req.body;
    
    console.log('📁 Creating category in Firestore:', name);
    
    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }
    
    if (!userEmail) {
      return res.status(400).json({ error: 'User email is required' });
    }
    
    // Generate ID and check for duplicates
    const categoryId = generateCategoryId(name.trim());
    const categoryDocRef = doc(db, 'categories', categoryId);
    const existingDoc = await getDoc(categoryDocRef);
    
    if (existingDoc.exists()) {
      return res.status(400).json({ 
        error: 'Category with this name already exists',
        suggestion: `Try "${name} 2" or "${name} Custom"`
      });
    }
    
    // Get next sort order
    const categoriesRef = collection(db, 'categories');
    const sortQuery = query(categoriesRef, orderBy('sortOrder', 'desc'));
    const sortSnapshot = await getDocs(sortQuery);
    const lastCategory = sortSnapshot.docs[0];
    const sortOrder = lastCategory ? (lastCategory.data().sortOrder || 0) + 10 : 10;
    
    const categoryData = {
      name: name.trim(),
      description: description?.trim() || '',
      color: color || '#8B5CF6', // Default purple
      icon: icon || 'folder',
      sortOrder,
      isSystem: false,
      isActive: true,
      createdBy: userEmail,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      promptCount: 0,
      lastUsed: serverTimestamp()
    };
    
    await updateDoc(categoryDocRef, categoryData);
    
    console.log(`✅ Created category in Firestore: ${name} (${categoryId})`);
    
    // Return the created category with the ID
    const createdCategory = {
      id: categoryId,
      ...categoryData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastUsed: new Date().toISOString()
    };
    
    res.status(201).json({
      success: true,
      category: createdCategory,
      message: `Category "${name}" created successfully`
    });
    
  } catch (error) {
    console.error('❌ Failed to create category in Firestore:', error);
    res.status(500).json({ 
      error: 'Failed to create category',
      details: error.message 
    });
  }
});

// Update category
router.put('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, color, icon, userEmail } = req.body;
    
    console.log('📁 Updating category in Firestore:', id);
    
    const categoryDocRef = doc(db, 'categories', id);
    const categoryDoc = await getDoc(categoryDocRef);
    
    if (!categoryDoc.exists()) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    const categoryData = categoryDoc.data();
    
    // Prevent editing system categories' core properties
    if (categoryData.isSystem && name && name !== categoryData.name) {
      return res.status(403).json({ 
        error: 'Cannot rename system categories',
        allowedChanges: ['description', 'color', 'icon']
      });
    }
    
    const updates = {
      updatedAt: serverTimestamp()
    };
    
    // Handle name change (requires ID change)
    if (name && name.trim() !== categoryData.name) {
      const newId = generateCategoryId(name.trim());
      
      // Check if new ID already exists
      const newDocRef = doc(db, 'categories', newId);
      const existingDoc = await getDoc(newDocRef);
      
      if (existingDoc.exists()) {
        return res.status(400).json({ error: 'Category with this name already exists' });
      }
      
      // Create new document with new ID
      const newCategoryData = {
        ...categoryData,
        name: name.trim(),
        updatedAt: serverTimestamp()
      };
      
      if (description !== undefined) newCategoryData.description = description.trim();
      if (color) newCategoryData.color = color;
      if (icon) newCategoryData.icon = icon;
      
      // Use batch write to create new and delete old
      const batch = writeBatch(db);
      batch.set(newDocRef, newCategoryData);
      batch.delete(categoryDocRef);
      
      // Update all prompts that reference this category
      const promptsRef = collection(db, 'prompts');
      const promptQuery = query(promptsRef, where('category', '==', id));
      const promptSnapshot = await getDocs(promptQuery);
      
      promptSnapshot.docs.forEach(promptDoc => {
        batch.update(promptDoc.ref, { 
          category: newId,
          updatedAt: serverTimestamp()
        });
      });
      
      await batch.commit();
      
      console.log(`✅ Updated category in Firestore: ${name} (${id} → ${newId})`);
      
      res.json({
        success: true,
        category: {
          id: newId,
          ...newCategoryData,
          updatedAt: new Date().toISOString()
        },
        message: `Category "${name}" updated successfully`,
        idChanged: true,
        oldId: id,
        newId: newId
      });
      
      return;
    }
    
    // Simple update without ID change
    if (description !== undefined) updates.description = description.trim();
    if (color) updates.color = color;
    if (icon) updates.icon = icon;
    
    await updateDoc(categoryDocRef, updates);
    
    console.log(`✅ Updated category in Firestore: ${categoryData.name}`);
    
    const updatedCategory = {
      id,
      ...categoryData,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    
    res.json({
      success: true,
      category: updatedCategory,
      message: `Category "${categoryData.name}" updated successfully`
    });
    
  } catch (error) {
    console.error('❌ Failed to update category in Firestore:', error);
    res.status(500).json({ 
      error: 'Failed to update category',
      details: error.message 
    });
  }
});

// Delete category (soft delete)
router.delete('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userEmail, movePromptsTo } = req.body;
    
    console.log('📁 Deleting category in Firestore:', id);
    
    const categoryDocRef = doc(db, 'categories', id);
    const categoryDoc = await getDoc(categoryDocRef);
    
    if (!categoryDoc.exists()) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    const categoryData = categoryDoc.data();
    
    // Prevent deletion of system categories
    if (categoryData.isSystem) {
      return res.status(403).json({ 
        error: 'Cannot delete system categories',
        systemCategories: ['purchase_order', 'proforma_invoice', 'bank_payment', 'extraction']
      });
    }
    
    // Check for existing prompts
    const promptsRef = collection(db, 'prompts');
    const promptQuery = query(promptsRef, where('category', '==', id));
    const promptSnapshot = await getDocs(promptQuery);
    const promptCount = promptSnapshot.size;
    
    if (promptCount > 0) {
      if (!movePromptsTo) {
        // Get available categories for suggestion
        const categoriesRef = collection(db, 'categories');
        const catQuery = query(
          categoriesRef, 
          where('isActive', '==', true),
          where('__name__', '!=', id)
        );
        const catSnapshot = await getDocs(catQuery);
        const availableCategories = catSnapshot.docs.map(doc => ({
          id: doc.id,
          name: doc.data().name
        }));
        
        return res.status(400).json({ 
          error: `Cannot delete category with ${promptCount} prompts`,
          promptCount,
          suggestion: 'Move prompts to another category first',
          availableCategories
        });
      }
      
      // Verify target category exists
      const targetDocRef = doc(db, 'categories', movePromptsTo);
      const targetDoc = await getDoc(targetDocRef);
      
      if (!targetDoc.exists()) {
        return res.status(400).json({ error: 'Target category not found' });
      }
      
      // Move prompts to target category using batch
      const batch = writeBatch(db);
      
      promptSnapshot.docs.forEach(promptDoc => {
        batch.update(promptDoc.ref, { 
          category: movePromptsTo,
          updatedAt: serverTimestamp()
        });
      });
      
      await batch.commit();
      
      console.log(`📋 Moved ${promptCount} prompts from ${id} to ${movePromptsTo}`);
    }
    
    // Soft delete (mark as inactive)
    await updateDoc(categoryDocRef, {
      isActive: false,
      deletedAt: serverTimestamp(),
      deletedBy: userEmail,
      updatedAt: serverTimestamp()
    });
    
    console.log(`✅ Deleted category in Firestore: ${categoryData.name}`);
    
    res.json({
      success: true,
      message: `Category "${categoryData.name}" deleted successfully`,
      promptsMoved: promptCount,
      movedTo: movePromptsTo
    });
    
  } catch (error) {
    console.error('❌ Failed to delete category in Firestore:', error);
    res.status(500).json({ 
      error: 'Failed to delete category',
      details: error.message 
    });
  }
});

// Update category sort order
router.put('/categories/reorder', async (req, res) => {
  try {
    const { categories, userEmail } = req.body;
    
    console.log('📁 Reordering categories in Firestore...');
    
    const batch = writeBatch(db);
    
    categories.forEach((cat, index) => {
      const categoryDocRef = doc(db, 'categories', cat.id);
      batch.update(categoryDocRef, { 
        sortOrder: (index + 1) * 10,
        updatedAt: serverTimestamp()
      });
    });
    
    await batch.commit();
    
    console.log(`✅ Reordered ${categories.length} categories in Firestore`);
    
    res.json({
      success: true,
      message: 'Categories reordered successfully'
    });
    
  } catch (error) {
    console.error('❌ Failed to reorder categories in Firestore:', error);
    res.status(500).json({ 
      error: 'Failed to reorder categories',
      details: error.message 
    });
  }
});

// Get category analytics
router.get('/categories/:id/analytics', async (req, res) => {
  try {
    const { id } = req.params;
    
    const categoryDocRef = doc(db, 'categories', id);
    const categoryDoc = await getDoc(categoryDocRef);
    
    if (!categoryDoc.exists()) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    const categoryData = { id: categoryDoc.id, ...categoryDoc.data() };
    
    // Get prompts in this category
    const promptsRef = collection(db, 'prompts');
    const promptQuery = query(promptsRef, where('category', '==', id));
    const promptSnapshot = await getDocs(promptQuery);
    
    const prompts = promptSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    const analytics = {
      category: categoryData,
      promptCount: prompts.length,
      activePrompts: prompts.filter(p => p.isActive !== false).length,
      totalUsage: prompts.reduce((sum, p) => sum + (p.usageCount || 0), 0),
      lastUsed: prompts.reduce((latest, p) => {
        if (!p.lastUsed) return latest;
        const pLastUsed = p.lastUsed.toDate ? p.lastUsed.toDate() : new Date(p.lastUsed);
        return pLastUsed > latest ? pLastUsed : latest;
      }, new Date(0)),
      topPrompts: prompts
        .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
        .slice(0, 5)
        .map(p => ({ 
          id: p.id, 
          name: p.name, 
          usageCount: p.usageCount || 0 
        }))
    };
    
    res.json(analytics);
    
  } catch (error) {
    console.error('❌ Failed to get category analytics from Firestore:', error);
    res.status(500).json({ 
      error: 'Failed to get category analytics',
      details: error.message 
    });
  }
});

// ================================================================
// INITIALIZE DEFAULT CATEGORIES IN FIRESTORE
// ================================================================

const initializeDefaultCategories = async () => {
  try {
    console.log('📁 Initializing default categories in Firestore...');
    
    const defaultCategories = [
      {
        id: 'purchase_order',
        name: 'Purchase Order',
        description: 'Purchase order processing and extraction prompts',
        color: '#3B82F6',
        icon: 'shopping-cart',
        isSystem: true,
        sortOrder: 10
      },
      {
        id: 'proforma_invoice',
        name: 'Proforma Invoice',
        description: 'Proforma invoice processing and analysis prompts',
        color: '#059669',
        icon: 'file-text',
        isSystem: true,
        sortOrder: 20
      },
      {
        id: 'bank_payment',
        name: 'Bank Payment',
        description: 'Bank payment slip processing prompts',
        color: '#DC2626',
        icon: 'credit-card',
        isSystem: true,
        sortOrder: 30
      },
      {
        id: 'extraction',
        name: 'Extraction',
        description: 'General data extraction prompts',
        color: '#7C2D12',
        icon: 'download',
        isSystem: true,
        sortOrder: 40
      },
      {
        id: 'supplier_specific',
        name: 'Supplier Specific',
        description: 'Supplier-specific processing prompts',
        color: '#7C3AED',
        icon: 'users',
        isSystem: true,
        sortOrder: 50
      },
      {
        id: 'analytics',
        name: 'Analytics',
        description: 'Business analytics and reporting prompts',
        color: '#059669',
        icon: 'bar-chart-3',
        isSystem: true,
        sortOrder: 60
      },
      {
        id: 'classification',
        name: 'Classification',
        description: 'Document classification and categorization prompts',
        color: '#EA580C',
        icon: 'tag',
        isSystem: true,
        sortOrder: 70
      },
      {
        id: 'general',
        name: 'General',
        description: 'General purpose prompts',
        color: '#6B7280',
        icon: 'folder',
        isSystem: true,
        sortOrder: 80
      }
    ];
    
    const batch = writeBatch(db);
    
    for (const categoryData of defaultCategories) {
      const categoryDocRef = doc(db, 'categories', categoryData.id);
      const existingDoc = await getDoc(categoryDocRef);
      
      if (!existingDoc.exists()) {
        const firestoreData = {
          ...categoryData,
          isActive: true,
          createdBy: 'system@higgsflow.com',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          promptCount: 0,
          lastUsed: serverTimestamp()
        };
        
        batch.set(categoryDocRef, firestoreData);
        console.log(`✅ Will create default category: ${categoryData.name}`);
      }
    }
    
    await batch.commit();
    console.log('✅ Default categories initialized in Firestore');
    
  } catch (error) {
    console.error('❌ Failed to initialize default categories in Firestore:', error);
  }
};

module.exports = { router, initializeDefaultCategories };
