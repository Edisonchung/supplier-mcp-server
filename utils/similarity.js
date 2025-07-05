// utils/similarity.js

function calculateSimilarity(po1, po2) {
  let score = 0;
  let factors = 0;
  
  // Client name similarity
  if (po1.clientName && po2.clientName) {
    score += stringSimilarity(po1.clientName, po2.clientName) * 0.3;
    factors += 0.3;
  }
  
  // Date proximity
  if (po1.orderDate && po2.orderDate) {
    const daysDiff = Math.abs(new Date(po1.orderDate) - new Date(po2.orderDate)) / (1000 * 60 * 60 * 24);
    score += Math.max(0, (7 - daysDiff) / 7) * 0.2;
    factors += 0.2;
  }
  
  // Items similarity
  if (po1.items && po2.items) {
    score += itemsSimilarity(po1.items, po2.items) * 0.5;
    factors += 0.5;
  }
  
  return factors > 0 ? score / factors : 0;
}

function stringSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

function itemsSimilarity(items1, items2) {
  if (!items1.length || !items2.length) return 0;
  
  let matches = 0;
  
  for (const item1 of items1) {
    for (const item2 of items2) {
      if (stringSimilarity(item1.productName, item2.productName) > 0.8 ||
          item1.productCode === item2.productCode) {
        matches++;
        break;
      }
    }
  }
  
  return matches / Math.max(items1.length, items2.length);
}

module.exports = {
  calculateSimilarity,
  stringSimilarity,
  levenshteinDistance,
  itemsSimilarity
};
