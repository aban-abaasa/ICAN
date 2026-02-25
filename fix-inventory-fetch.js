const fs = require('fs');
const path = require('path');

// Read the CMSSModule.jsx file
const filePath = path.join(__dirname, 'frontend/src/components/CMSSModule.jsx');
let content = fs.readFileSync(filePath, 'utf-8');

console.log('File size:', content.length);

// Try to find getCmmsDepartments
const getCmmsIndex = content.indexOf('getCmmsDepartments(companyIdToUse)');
if (getCmmsIndex === -1) {
  console.log('Could not find getCmmsDepartments');
  process.exit(1);
}

console.log('Found getCmmsDepartments at index:', getCmmsIndex);

// Find the context around it - go back and forward
const contextStart = Math.max(0, getCmmsIndex - 200);
const contextEnd = Math.min(content.length, getCmmsIndex + 500);
const context = content.slice(contextStart, contextEnd);
console.log('Context:\n', context);

// Now look for the closing of the departments block
// Search for "Error loading departments from Supabase"
const errorIndex = content.indexOf('Error loading departments from Supabase');
if (errorIndex === -1) {
  console.log('Could not find error message for departments');
  
  // Try alternative - search for line after getCmmsDepartments
  const closeIndex = getCmmsIndex + 100;
  const contextAfter = content.slice(closeIndex, closeIndex + 300);
  console.log('Context after getCmmsDepartments:\n', contextAfter);
  
  process.exit(1);
}

console.log('Found error message at index:', errorIndex);

// Now find the closing brace after this error handling
let braceIndex = errorIndex;
while (braceIndex < content.length && content[braceIndex] !== '}') {
  braceIndex++;
}
braceIndex++; // Move past the closing brace

const inventoryCode = `\n\n      // Fetch inventory items from Supabase (source of truth)\n      const { data: inventoryItems, error: inventoryError } = await cmmsService.getCompanyInventory(companyIdToUse);\n      if (!inventoryError && inventoryItems && inventoryItems.length > 0) {\n        console.log(\\\`Loaded \\\${inventoryItems.length} inventory items from Supabase\\\`);\n        setCmmsData(prev => ({\n          ...prev,\n          inventory: inventoryItems\n        }));\n      } else if (!inventoryError) {\n        console.log('No inventory items found for this company');\n        setCmmsData(prev => ({\n          ...prev,\n          inventory: []\n        }));\n      } else {\n        console.error('Error loading inventory from Supabase:', inventoryError);\n        setCmmsData(prev => ({\n          ...prev,\n          inventory: []\n        }));\n      }`;

const newContent = content.slice(0, braceIndex) + inventoryCode + content.slice(braceIndex);
fs.writeFileSync(filePath, newContent, 'utf-8');
console.log('✓ Inventory fetching code inserted successfully at index:', braceIndex);
