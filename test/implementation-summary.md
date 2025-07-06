# PTP Supplier Template Implementation

## Overview
This implementation adds automatic detection and specialized extraction for PT. PERINTIS TEKNOLOGI PERDANA (PTP) purchase orders.

## Problem Solved
- PTP uses a multi-line format where product names appear on the line below part numbers
- AI was incorrectly extracting UOM values (PCS, UNI, SET) as product names
- Example: "THRUSTER" was being extracted as "PCS"

## Solution Components

### 1. Supplier Detection (`utils/supplierTemplates.js`)
- Detects PTP documents by searching for company name patterns
- Returns supplier ID and confidence level

### 2. PTP-Specific Prompt (`getPTPSpecificPrompt()`)
- Custom prompt explaining PTP's multi-line format
- Clear examples showing product names below part numbers

### 3. Post-Processing Rules (`applyPTPRules()`)
- Checks if product name is a UOM value
- Searches for actual product name on the next line
- Fixes extraction errors automatically

### 4. Enhanced API Response
```json
{
  "metadata": {
    "supplier": "PTP",
    "supplierConfidence": 0.75,
    "extractionMethod": "PTP_TEMPLATE"
  }
}
