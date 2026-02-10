const fs = require('fs');
const path = require('path');

const filePath = 'frontend/src/components/TrustSystem.jsx';
let content = fs.readFileSync(filePath, 'utf8');

// Create the new tabs section
const newTabsSection = `        {/* Tabs - Desktop View */}
        <div className="hidden sm:flex gap-4 border-b border-slate-700 py-0">
          <button onClick={() => { setActiveTab('explore'); setShowMobileMenu(false); }} className={\`px-6 py-4 font-semibold text-base transition-all flex items-center gap-2 whitespace-nowrap relative \${activeTab === 'explore' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}\`}>🔍 Explore</button>
          <button onClick={() => { setActiveTab('mygroups'); setShowMobileMenu(false); }} className={\`px-6 py-4 font-semibold text-base transition-all flex items-center gap-2 whitespace-nowrap relative \${activeTab === 'mygroups' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}\`}>👥 My Trusts</button>
          <button onClick={() => { setActiveTab('voting'); setShowMobileMenu(false); }} className={\`px-6 py-4 font-semibold text-base transition-all flex items-center gap-2 whitespace-nowrap relative \${activeTab === 'voting' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}\`}>🗳️ Vote {votingApplications.length > 0 && <span className="ml-1 px-2 py-0.5 bg-red-500 text-white text-xs rounded-full font-bold">{votingApplications.length}</span>}</button>
          <button onClick={() => { setActiveTab('applications'); setShowMobileMenu(false); }} className={\`px-6 py-4 font-semibold text-base transition-all flex items-center gap-2 whitespace-nowrap relative \${activeTab === 'applications' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}\`}>📮 Applications {myApplications.length > 0 && <span className="ml-1 px-2 py-0.5 bg-red-500 text-white text-xs rounded-full font-bold">{myApplications.length}</span>}</button>
          <button onClick={() => { setActiveTab('create'); setShowMobileMenu(false); }} className={\`px-6 py-4 font-semibold text-base transition-all flex items-center gap-2 whitespace-nowrap relative \${activeTab === 'create' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}\`}>✨ Create</button>
          <button onClick={() => { setActiveTab('admin'); setShowMobileMenu(false); }} className={\`px-6 py-4 font-semibold text-base transition-all flex items-center gap-2 whitespace-nowrap relative \${activeTab === 'admin' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}\`}>👑 Admin Panel</button>
        </div>

        {/* Tabs - Mobile View with Dots Menu */}
        <div className="sm:hidden flex items-center justify-between border-b border-slate-700 py-2 px-3 relative">
          <div className="flex gap-2 flex-1">
            <button onClick={() => { setActiveTab('explore'); setShowMobileMenu(false); }} className={\`px-2 py-2 font-semibold text-sm transition-all flex items-center gap-1 whitespace-nowrap relative \${activeTab === 'explore' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}\`}>🔍</button>
            <button onClick={() => { setActiveTab('mygroups'); setShowMobileMenu(false); }} className={\`px-2 py-2 font-semibold text-sm transition-all flex items-center gap-1 whitespace-nowrap relative \${activeTab === 'mygroups' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-300'}\`}>👥</button>
          </div>
          
          <div className="relative">
            <button onClick={() => setShowMobileMenu(!showMobileMenu)} className="p-2 hover:bg-slate-800/50 rounded-lg transition-colors text-slate-400 hover:text-white"><MoreVertical className="w-5 h-5" /></button>
            {showMobileMenu && (
              <div className="absolute right-0 top-full mt-2 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 min-w-max">
                <button onClick={() => { setActiveTab('voting'); setShowMobileMenu(false); }} className={\`w-full text-left px-4 py-3 font-medium transition-all flex items-center justify-between gap-3 \${activeTab === 'voting' ? 'bg-amber-600/20 text-amber-400' : 'text-slate-300 hover:bg-slate-700/50'}\`}>🗳️ Vote {votingApplications.length > 0 && <span className="ml-auto px-2 py-1 bg-red-500 text-white text-xs rounded-full font-bold flex-shrink-0">{votingApplications.length}</span>}</button>
                <button onClick={() => { setActiveTab('applications'); setShowMobileMenu(false); }} className={\`w-full text-left px-4 py-3 font-medium transition-all flex items-center justify-between gap-3 \${activeTab === 'applications' ? 'bg-amber-600/20 text-amber-400' : 'text-slate-300 hover:bg-slate-700/50'}\`}>📮 Applications {myApplications.length > 0 && <span className="ml-auto px-2 py-1 bg-red-500 text-white text-xs rounded-full font-bold flex-shrink-0">{myApplications.length}</span>}</button>
                <button onClick={() => { setActiveTab('create'); setShowMobileMenu(false); }} className={\`w-full text-left px-4 py-3 font-medium transition-all flex items-center justify-between gap-3 \${activeTab === 'create' ? 'bg-amber-600/20 text-amber-400' : 'text-slate-300 hover:bg-slate-700/50'}\`}>✨ Create</button>
                <button onClick={() => { setActiveTab('admin'); setShowMobileMenu(false); }} className={\`w-full text-left px-4 py-3 font-medium transition-all flex items-center justify-between gap-3 \${activeTab === 'admin' ? 'bg-amber-600/20 text-amber-400' : 'text-slate-300 hover:bg-slate-700/50'}\`}>👑 Admin Panel</button>
              </div>
            )}
          </div>
        </div>`;

// Find the old tabs section - match from "        {/* Tabs */}" to the closing </div> of the tabs container
const tabsCommentStart = content.indexOf('        {/* Tabs */}');
if (tabsCommentStart === -1) {
  console.log('❌ Could not find tabs comment');
  process.exit(1);
}

// Find the end by looking for the closing </div> after the .map() function
let closingDivCount = 0;
let searchStart = tabsCommentStart;
let foundEnd = false;
let endIndex = -1;

// Simple approach: find the </div> that closes the flex container
// Count opening and closing divs starting from the tabs comment
let openCount = 1;
let pos = tabsCommentStart + 20; // Start after the comment

while (pos < content.length && openCount > 0) {
  const nextOpen = content.indexOf('<div', pos);
  const nextClose = content.indexOf('</div>', pos);
  
  if (nextClose === -1) {
    console.log('❌ Could not find closing div');
    process.exit(1);
  }
  
  if (nextOpen !== -1 && nextOpen < nextClose) {
    openCount++;
    pos = nextOpen + 4;
  } else {
    openCount--;
    if (openCount === 0) {
      endIndex = nextClose + 6; // Include the </div>
    }
    pos = nextClose + 6;
  }
}

if (endIndex === -1) {
  console.log('❌ Could not determine tabs section end');
  process.exit(1);
}

// Replace the old tabs section with the new one
const newContent = content.substring(0, tabsCommentStart) + newTabsSection + content.substring(endIndex);

// Write the file
fs.writeFileSync(filePath, newContent, 'utf8');
console.log('✅ Tabs section successfully replaced!');
console.log('📍 Replaced content from position', tabsCommentStart, 'to', endIndex);
console.log('📍 Desktop view: 6 tabs horizontally');
console.log('📍 Mobile view: 2 tabs + MoreVertical dropdown menu');
console.log('✨ All functionality (Vote, Applications, Admin) now in dropdown menu on mobile');
