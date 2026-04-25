/**
 * CMMS Enhanced Typography Utilities
 * Strengthens font visibility across all modes (light, dark, white)
 */

export const buttonStylesStrengthened = {
  // Primary Action Buttons (Edit, Delete, Export, etc)
  base: 'font-bold text-sm px-3 py-1 rounded transition-all duration-200 font-sans',
  
  // Edit Button - Strong visibility
  edit: 'bg-blue-600 text-white font-bold hover:bg-blue-700 shadow-md hover:shadow-lg active:scale-95',
  editAlt: 'bg-blue-500 text-white font-extrabold hover:bg-blue-600 border-0 focus:outline-none',
  
  // Delete Button - Strong visibility
  delete: 'bg-red-600 text-white font-bold hover:bg-red-700 shadow-md hover:shadow-lg active:scale-95',
  deleteAlt: 'bg-red-500 text-white font-extrabold hover:bg-red-600 border-0 focus:outline-none',
  
  // Export Button - Strong visibility
  export: 'bg-green-600 text-white font-bold hover:bg-green-700 shadow-md hover:shadow-lg active:scale-95',
  exportAlt: 'bg-emerald-500 text-white font-extrabold hover:bg-emerald-600 border-0 focus:outline-none',
  
  // View/Details Button
  view: 'bg-gray-700 text-white font-bold hover:bg-gray-800 shadow-md hover:shadow-lg',
  viewAlt: 'bg-slate-600 text-white font-extrabold hover:bg-slate-700 border-0 focus:outline-none',
  
  // Add Button
  add: 'bg-green-600 text-white font-bold hover:bg-green-700 shadow-md hover:shadow-lg',
  addAlt: 'bg-green-500 text-white font-extrabold hover:bg-green-600 border-0 focus:outline-none',
  
  // Cancel Button
  cancel: 'bg-gray-500 text-white font-bold hover:bg-gray-600 shadow-md hover:shadow-lg',
  cancelAlt: 'bg-gray-400 text-gray-900 font-extrabold hover:bg-gray-500 border-0 focus:outline-none',
};

export const textStylesStrengthened = {
  // Inventory labels
  label: 'font-semibold text-gray-800 dark:text-gray-100',
  labelStrong: 'font-bold text-gray-900 dark:text-white',
  
  // Action text
  action: 'font-bold text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-100',
  actionStrong: 'font-extrabold text-blue-800 dark:text-blue-200',
  
  // Status text
  status: 'font-semibold text-gray-700 dark:text-gray-200',
  statusStrong: 'font-bold text-gray-900 dark:text-white',
  
  // Header text
  header: 'font-bold text-lg text-gray-900 dark:text-white',
  headerLarge: 'font-bold text-2xl text-gray-950 dark:text-white',
  
  // Body text (always readable)
  body: 'font-medium text-gray-700 dark:text-gray-300',
  bodyStrong: 'font-semibold text-gray-800 dark:text-gray-100',
};

export const tableStylesStrengthened = {
  // Table header
  thead: 'bg-gray-200 dark:bg-gray-700 border-b-2 border-gray-300 dark:border-gray-600',
  theadText: 'font-bold text-gray-900 dark:text-white text-sm',
  
  // Table body
  tbody: 'bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700',
  tbodyText: 'font-medium text-gray-800 dark:text-gray-200 text-sm',
  
  // Row hover
  rowHover: 'hover:bg-blue-50 dark:hover:bg-gray-800 transition-colors',
};

export const whiteModeFix = {
  // For white mode backgrounds
  textOnWhite: 'text-gray-900 font-bold',
  textOnWhiteAlt: 'text-gray-800 font-semibold',
  
  // For colored backgrounds in white mode
  textOnColor: 'text-white font-bold',
  
  // Links in white mode
  linkWhiteMode: 'text-blue-700 font-bold hover:text-blue-900 hover:underline',
  
  // Badges/pills
  badgeStrong: 'font-bold px-2 py-1 rounded-full text-sm',
};

/**
 * Apply strengthened styles to any button or text element
 * Usage: className={`${buttonStylesStrengthened.edit}`}
 */
export const applyStrongStyles = (baseClass, strength = 'bold') => {
  const strengthMap = {
    'semi': 'font-semibold',
    'bold': 'font-bold',
    'extrabold': 'font-extrabold',
    'black': 'font-black',
  };
  
  return `${baseClass} ${strengthMap[strength]}`;
};

/**
 * Ensure text contrast in white mode
 */
export const ensureWhiteModeContrast = (element, isDarkText = true) => {
  return isDarkText 
    ? 'text-gray-900 dark:text-white font-bold'
    : 'text-white dark:text-gray-900 font-bold';
};

export default {
  buttonStylesStrengthened,
  textStylesStrengthened,
  tableStylesStrengthened,
  whiteModeFix,
  applyStrongStyles,
  ensureWhiteModeContrast,
};
