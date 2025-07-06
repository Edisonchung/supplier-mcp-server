# PTP Quick Reference

## When PTP Template Activates
- Document contains "PT. PERINTIS TEKNOLOGI PERDANA"
- Document contains "PT PERINTIS TEKNOLOGI"
- Document contains "Kawasan Industri Pulogadung"

## What It Does
1. Uses special prompt for multi-line format
2. Fixes UOM (PCS, UNI, SET) incorrectly extracted as product names
3. Looks for product descriptions on the line below part numbers

## API Response Includes
```json
"metadata": {
  "supplier": "PTP",
  "supplierConfidence": 0.75,
  "extractionMethod": "PTP_TEMPLATE"
}
