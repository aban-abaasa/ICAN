// ============================================
// CMMS (Computerized Maintenance Management System)
// ============================================
// Role hierarchy:
// Admin (creates company, assigns all roles)
//   ├── Department Coordinators
//   │   ├── Supervisors
//   │   ├── Technicians
//   │   └── Storemen
//   ├── Financial Officer
//   └── Service Providers (can select multiple service types)

const CMMSModule = ({ 
  onDataUpdate,
  netWorth,
  currentJourneyStage 
}) => {
  const [cmmsData, setCmmsData] = useState({
    companyProfile: null,
    users: [],
    departments: [],
    workOrders: [],
    inventory: [],
    serviceProviders: [],
    maintenancePlans: []
  });

  const [activeTab, setActiveTab] = useState('company'); // company, users, inventory, workorders, service-providers
  const [editingUser, setEditingUser] = useState(null);

  // ============================================
  // COMPANY PROFILE MANAGEMENT
  // ============================================
  const CompanyProfileManager = () => {
    const [formData, setFormData] = useState({
      companyName: cmmsData.companyProfile?.companyName || '',
      companyRegistration: cmmsData.companyProfile?.companyRegistration || '',
      location: cmmsData.companyProfile?.location || '',
      phone: cmmsData.companyProfile?.phone || '',
      email: cmmsData.companyProfile?.email || '',
      industry: cmmsData.companyProfile?.industry || 'Manufacturing'
    });

    const handleSaveProfile = () => {
      setCmmsData(prev => ({
        ...prev,
        companyProfile: { ...formData, createdAt: new Date() }
      }));
      onDataUpdate({ companyProfile: formData });
    };

    if (!cmmsData.companyProfile) {
      return (
        <div className="glass-card p-6 space-y-4">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Building className="w-6 h-6 text-blue-400" />
            Create Company Profile
          </h3>

          <div className="grid md:grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="Company Name"
              value={formData.companyName}
              onChange={(e) => setFormData({...formData, companyName: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <input
              type="text"
              placeholder="Registration Number"
              value={formData.companyRegistration}
              onChange={(e) => setFormData({...formData, companyRegistration: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <input
              type="text"
              placeholder="Location"
              value={formData.location}
              onChange={(e) => setFormData({...formData, location: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <input
              type="tel"
              placeholder="Phone"
              value={formData.phone}
              onChange={(e) => setFormData({...formData, phone: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <input
              type="email"
              placeholder="Email"
              value={formData.email}
              onChange={(e) => setFormData({...formData, email: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <select
              value={formData.industry}
              onChange={(e) => setFormData({...formData, industry: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white"
            >
              <option value="Manufacturing">Manufacturing</option>
              <option value="Healthcare">Healthcare</option>
              <option value="Transportation">Transportation</option>
              <option value="Building Management">Building Management</option>
              <option value="Industrial">Industrial</option>
              <option value="Energy">Energy</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <button
            onClick={handleSaveProfile}
            className="w-full px-4 py-2 bg-gradient-to-r from-blue-500 to-green-500 text-white rounded-lg font-semibold hover:from-blue-600 hover:to-green-600 transition-all"
          >
            Create Company Profile
          </button>
        </div>
      );
    }

    return (
      <div className="glass-card p-6">
        <h3 className="text-xl font-bold text-white mb-4">Company Profile</h3>
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div className="bg-white bg-opacity-5 p-4 rounded">
            <div className="text-gray-400 text-sm">Company Name</div>
            <div className="text-white font-bold">{cmmsData.companyProfile.companyName}</div>
          </div>
          <div className="bg-white bg-opacity-5 p-4 rounded">
            <div className="text-gray-400 text-sm">Registration</div>
            <div className="text-white font-bold">{cmmsData.companyProfile.companyRegistration}</div>
          </div>
          <div className="bg-white bg-opacity-5 p-4 rounded">
            <div className="text-gray-400 text-sm">Location</div>
            <div className="text-white font-bold">{cmmsData.companyProfile.location}</div>
          </div>
          <div className="bg-white bg-opacity-5 p-4 rounded">
            <div className="text-gray-400 text-sm">Email</div>
            <div className="text-white font-bold">{cmmsData.companyProfile.email}</div>
          </div>
        </div>
        <button
          onClick={() => setCmmsData(prev => ({...prev, companyProfile: null}))}
          className="px-4 py-2 bg-orange-500 bg-opacity-30 text-orange-300 rounded-lg hover:bg-opacity-40 transition-all"
        >
          Edit Profile
        </button>
      </div>
    );
  };

  // ============================================
  // USER ROLE MANAGEMENT
  // ============================================
  const UserRoleManager = () => {
    const [newUser, setNewUser] = useState({
      name: '',
      email: '',
      phone: '',
      role: 'Technician',
      department: '',
      assignedServices: []
    });

    const roles = [
      { id: 'admin', label: 'Admin', color: 'from-red-500 to-pink-600', icon: '👑' },
      { id: 'coordinator', label: 'Department Coordinator', color: 'from-blue-500 to-cyan-600', icon: '📋' },
      { id: 'supervisor', label: 'Supervisor', color: 'from-purple-500 to-indigo-600', icon: '👔' },
      { id: 'technician', label: 'Technician', color: 'from-green-500 to-emerald-600', icon: '🔧' },
      { id: 'storeman', label: 'Storeman', color: 'from-yellow-500 to-orange-600', icon: '📦' },
      { id: 'finance', label: 'Financial Officer', color: 'from-teal-500 to-cyan-600', icon: '💰' },
      { id: 'service-provider', label: 'Service Provider', color: 'from-violet-500 to-purple-600', icon: '🏢' }
    ];

    const handleAddUser = () => {
      if (newUser.name && newUser.email && newUser.role) {
        const user = {
          id: Date.now(),
          ...newUser,
          createdAt: new Date(),
          status: 'Active'
        };
        setCmmsData(prev => ({
          ...prev,
          users: [...prev.users, user]
        }));
        setNewUser({ name: '', email: '', phone: '', role: 'Technician', department: '', assignedServices: [] });
      }
    };

    const handleDeleteUser = (userId) => {
      setCmmsData(prev => ({
        ...prev,
        users: prev.users.filter(u => u.id !== userId)
      }));
    };

    return (
      <div className="space-y-6">
        {/* Add New User Form */}
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <User className="w-6 h-6 text-blue-400" />
            Add New User
          </h3>

          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <input
              type="text"
              placeholder="Full Name"
              value={newUser.name}
              onChange={(e) => setNewUser({...newUser, name: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <input
              type="email"
              placeholder="Email"
              value={newUser.email}
              onChange={(e) => setNewUser({...newUser, email: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <input
              type="tel"
              placeholder="Phone"
              value={newUser.phone}
              onChange={(e) => setNewUser({...newUser, phone: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <select
              value={newUser.role}
              onChange={(e) => setNewUser({...newUser, role: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white"
            >
              {roles.map(r => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>

          {(newUser.role === 'coordinator' || newUser.role === 'supervisor' || newUser.role === 'technician' || newUser.role === 'storeman') && (
            <input
              type="text"
              placeholder="Department"
              value={newUser.department}
              onChange={(e) => setNewUser({...newUser, department: e.target.value})}
              className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 mb-4"
            />
          )}

          {newUser.role === 'service-provider' && (
            <div className="mb-4">
              <label className="text-white text-sm mb-2 block">Select Services (can choose multiple):</label>
              <div className="grid grid-cols-2 gap-2">
                {['Preventive Maintenance', 'Corrective Maintenance', 'Installation', 'Inspection', 'Repair', 'Upgrade'].map(service => (
                  <button
                    key={service}
                    onClick={() => {
                      if (newUser.assignedServices.includes(service)) {
                        setNewUser({
                          ...newUser,
                          assignedServices: newUser.assignedServices.filter(s => s !== service)
                        });
                      } else {
                        setNewUser({
                          ...newUser,
                          assignedServices: [...newUser.assignedServices, service]
                        });
                      }
                    }}
                    className={`px-3 py-2 rounded text-sm font-medium transition-all ${
                      newUser.assignedServices.includes(service)
                        ? 'bg-green-500 text-white'
                        : 'bg-white bg-opacity-10 text-gray-300 hover:bg-opacity-20'
                    }`}
                  >
                    {newUser.assignedServices.includes(service) ? '✓ ' : '○ '}{service}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleAddUser}
            className="w-full px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-semibold hover:from-green-600 hover:to-emerald-700 transition-all"
          >
            Add User
          </button>
        </div>

        {/* Users List */}
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-white mb-4">Users & Roles ({cmmsData.users.length})</h3>
          <div className="space-y-3">
            {cmmsData.users.map(user => {
              const role = roles.find(r => r.id === user.role);
              return (
                <div key={user.id} className={`bg-gradient-to-r ${role?.color} bg-opacity-20 border border-current border-opacity-30 rounded-lg p-4`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-2xl">{role?.icon}</span>
                        <div>
                          <div className="text-white font-bold">{user.name}</div>
                          <div className="text-xs text-gray-300">{role?.label}</div>
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 space-y-1">
                        <div>📧 {user.email}</div>
                        {user.phone && <div>📱 {user.phone}</div>}
                        {user.department && <div>🏢 {user.department}</div>}
                        {user.assignedServices && user.assignedServices.length > 0 && (
                          <div>🔧 {user.assignedServices.join(', ')}</div>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteUser(user.id)}
                      className="px-3 py-1 bg-red-500 bg-opacity-30 text-red-300 rounded text-sm hover:bg-opacity-50 transition-all"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
            {cmmsData.users.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                No users assigned yet. Add users to get started.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ============================================
  // INVENTORY TRACKING
  // ============================================
  const InventoryManager = () => {
    const [newItem, setNewItem] = useState({
      name: '',
      category: 'Spare Parts',
      quantity: 0,
      minStock: 0,
      cost: 0,
      storeman: ''
    });

    const handleAddItem = () => {
      if (newItem.name && newItem.quantity >= 0) {
        setCmmsData(prev => ({
          ...prev,
          inventory: [...prev.inventory, {
            id: Date.now(),
            ...newItem,
            createdAt: new Date(),
            lastRestocked: new Date()
          }]
        }));
        setNewItem({ name: '', category: 'Spare Parts', quantity: 0, minStock: 0, cost: 0, storeman: '' });
      }
    };

    const lowStockItems = cmmsData.inventory.filter(item => item.quantity <= item.minStock);
    const totalInventoryValue = cmmsData.inventory.reduce((sum, item) => sum + (item.quantity * item.cost), 0);

    return (
      <div className="space-y-6">
        {/* Add Inventory Item */}
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Package className="w-6 h-6 text-blue-400" />
            Add Inventory Item
          </h3>

          <div className="grid md:grid-cols-3 gap-4 mb-4">
            <input
              type="text"
              placeholder="Item Name"
              value={newItem.name}
              onChange={(e) => setNewItem({...newItem, name: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <select
              value={newItem.category}
              onChange={(e) => setNewItem({...newItem, category: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white"
            >
              <option value="Spare Parts">Spare Parts</option>
              <option value="Tools">Tools</option>
              <option value="Materials">Materials</option>
              <option value="Equipment">Equipment</option>
              <option value="Consumables">Consumables</option>
            </select>
            <input
              type="number"
              placeholder="Quantity"
              value={newItem.quantity}
              onChange={(e) => setNewItem({...newItem, quantity: parseInt(e.target.value) || 0})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <input
              type="number"
              placeholder="Min Stock Level"
              value={newItem.minStock}
              onChange={(e) => setNewItem({...newItem, minStock: parseInt(e.target.value) || 0})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <input
              type="number"
              placeholder="Unit Cost (UGX)"
              value={newItem.cost}
              onChange={(e) => setNewItem({...newItem, cost: parseFloat(e.target.value) || 0})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <select
              value={newItem.storeman}
              onChange={(e) => setNewItem({...newItem, storeman: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white"
            >
              <option value="">Assign Storeman</option>
              {cmmsData.users.filter(u => u.role === 'storeman').map(u => (
                <option key={u.id} value={u.name}>{u.name}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleAddItem}
            className="w-full px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-semibold hover:from-green-600 hover:to-emerald-700 transition-all"
          >
            Add Item
          </button>
        </div>

        {/* Inventory Stats */}
        <div className="grid md:grid-cols-3 gap-4">
          <div className="glass-card p-4">
            <div className="text-gray-400 text-sm">Total Items</div>
            <div className="text-3xl font-bold text-blue-300">{cmmsData.inventory.length}</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-gray-400 text-sm">Inventory Value</div>
            <div className="text-3xl font-bold text-green-300">UGX {(totalInventoryValue / 1000000).toFixed(1)}M</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-gray-400 text-sm">Low Stock Alerts</div>
            <div className="text-3xl font-bold text-orange-300">{lowStockItems.length}</div>
          </div>
        </div>

        {/* Inventory List */}
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-white mb-4">Inventory Items</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {cmmsData.inventory.map(item => (
              <div key={item.id} className={`p-3 rounded-lg border ${
                item.quantity <= item.minStock
                  ? 'bg-orange-500 bg-opacity-20 border-orange-500 border-opacity-50'
                  : 'bg-white bg-opacity-5 border-white border-opacity-20'
              }`}>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="text-white font-semibold">{item.name}</div>
                    <div className="text-xs text-gray-400">
                      {item.category} • Stock: {item.quantity} (Min: {item.minStock}) • Cost: UGX {(item.cost * item.quantity).toLocaleString()}
                    </div>
                    {item.storeman && <div className="text-xs text-blue-300 mt-1">📦 {item.storeman}</div>}
                  </div>
                  {item.quantity <= item.minStock && (
                    <span className="px-2 py-1 bg-orange-500 text-white text-xs rounded font-bold">⚠️ LOW STOCK</span>
                  )}
                </div>
              </div>
            ))}
            {cmmsData.inventory.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                No inventory items yet.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ============================================
  // MAIN CMMS INTERFACE
  // ============================================
  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
          <Wrench className="w-8 h-8 text-purple-400" />
          CMMS Management System
        </h2>
        <div className="flex items-center gap-2 text-xs">
          {cmmsData.companyProfile ? (
            <span className="bg-green-500 bg-opacity-20 text-green-300 px-3 py-1 rounded-full">✓ {cmmsData.companyProfile.companyName}</span>
          ) : (
            <span className="bg-yellow-500 bg-opacity-20 text-yellow-300 px-3 py-1 rounded-full">⚠ Setup Required</span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-white border-opacity-10 overflow-x-auto">
        {[
          { id: 'company', label: '🏢 Company', icon: Building },
          { id: 'users', label: '👥 Users & Roles', icon: Users },
          { id: 'inventory', label: '📦 Inventory', icon: Package }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 font-semibold transition-all whitespace-nowrap border-b-2 ${
              activeTab === tab.id
                ? 'text-blue-300 border-blue-500'
                : 'text-gray-400 border-transparent hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'company' && <CompanyProfileManager />}
        {activeTab === 'users' && <UserRoleManager />}
        {activeTab === 'inventory' && <InventoryManager />}
      </div>
    </div>
  );
};
