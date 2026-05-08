#!/usr/bin/env node

/**
 * PWA Icon Generator
 * Generates multiple sizes of app icon from source image
 * Usage: node generate-icons.js
 */

const fs = require('fs');
const path = require('path');

// Using Sharp library for image resizing
try {
  const sharp = require('sharp');
  
  const iconSizes = [
    { size: 192, name: 'icon-192x192.png', purpose: 'any' },
    { size: 512, name: 'icon-512x512.png', purpose: 'any' },
    { size: 192, name: 'icon-192x192-maskable.png', purpose: 'maskable' },
    { size: 512, name: 'icon-512x512-maskable.png', purpose: 'maskable' }
  ];

  const sourceImage = path.join(__dirname, '../frontend/public/images/ican2.png');
  const outputDir = path.join(__dirname, '../frontend/public/icons');

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log('✅ Created icons directory');
  }

  // Generate each size
  let completed = 0;
  
  iconSizes.forEach(({ size, name }) => {
    sharp(sourceImage)
      .resize(size, size, {
        fit: 'cover',
        position: 'center'
      })
      .png()
      .toFile(path.join(outputDir, name), (err, info) => {
        if (err) {
          console.error(`❌ Error generating ${name}:`, err);
        } else {
          console.log(`✅ Generated ${name} (${size}x${size})`);
          completed++;
          
          if (completed === iconSizes.length) {
            console.log('\n🎉 All icons generated successfully!');
            console.log('📁 Icons saved to: frontend/public/icons/');
          }
        }
      });
  });

} catch (error) {
  console.error('❌ Sharp not installed. Install with: npm install sharp');
  console.log('\n📖 Manual Icon Generation Instructions:');
  console.log('=====================================\n');
  
  console.log('Option 1: Using Online Tool (Easy)');
  console.log('1. Go to: https://www.iloveimg.com/resize-image');
  console.log('2. Upload: frontend/public/images/ICANera1.png');
  console.log('3. Resize to 192x192px');
  console.log('4. Download and save to: frontend/public/icons/icon-192x192.png');
  console.log('5. Repeat for 512x512px to: frontend/public/icons/icon-512x512.png\n');
  
  console.log('Option 2: Using ImageMagick (Command Line)');
  console.log('convert frontend/public/images/ICANera1.png -resize 192x192 frontend/public/icons/icon-192x192.png');
  console.log('convert frontend/public/images/ICANera1.png -resize 512x512 frontend/public/icons/icon-512x512.png\n');
  
  console.log('Option 3: Using Sharp (Node.js)');
  console.log('npm install sharp');
  console.log('node scripts/generate-icons.js\n');
}
