import React, { useState, useEffect } from 'react';
import { Building2, Users, Plus, X, Trash2, DollarSign, PieChart, Loader, Search, CheckCircle2, AlertCircle, Wallet } from 'lucide-react';
import { createBusinessProfile, updateBusinessProfile, getSupabase, verifyICANUser, searchICANUsers, saveBusinessCoOwners } from '../services/pitchingService';
import { walletAccountService } from '../services/walletAccountService';

const BusinessProfileForm = ({ onProfileCreated, onCancel, userId, editingProfile }) => {
  const [step, setStep] = useState('business'); // business, owners, wallet, review
  const [loading, setLoading] = useState(false);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [emailSearchQuery, setEmailSearchQuery] = useState('');
  const [verificationStatus, setVerificationStatus] = useState({}); // Track verified emails
  const [businessData, setBusinessData] = useState({
    businessName: '',
    businessType: '',
    registrationNumber: '',
    taxId: '',
    website: '',
    description: '',
    businessAddress: '',
    foundedYear: new Date().getFullYear(),
    totalCapital: ''
  });

  const [coOwners, setCoOwners] = useState([]);

  // 💳 Wallet Account Fields
  const [walletData, setWalletData] = useState({
    preferredCurrency: 'UGX',
    pin: '',
    confirmPin: '',
    showPin: false
  });

  const [walletCreated, setWalletCreated] = useState(false);
  const [walletAccountNumber, setWalletAccountNumber] = useState(null);

  const [newOwner, setNewOwner] = useState({
    name: '',
    email: '',
    phone: '',
    ownershipShare: 0,
    role: 'Co-Founder',
    verified: false
  });

  const totalShare = coOwners.reduce((sum, owner) => sum + (owner.ownershipShare || owner.ownership_share || 0), 0);

  // Load profile data if editing
  useEffect(() => {
    if (editingProfile) {
      setBusinessData({
        businessName: editingProfile.business_name || '',
        businessType: editingProfile.business_type || '',
        registrationNumber: editingProfile.registration_number || '',
        taxId: editingProfile.tax_id || '',
        website: editingProfile.website || '',
        description: editingProfile.description || '',
        businessAddress: editingProfile.business_address || '',
        foundedYear: editingProfile.founded_year || new Date().getFullYear(),
        totalCapital: editingProfile.total_capital || ''
      });
      
      // Load co-owners - map database fields to form fields
      if (editingProfile.business_co_owners && editingProfile.business_co_owners.length > 0) {
        const mappedCoOwners = editingProfile.business_co_owners.map((owner, index) => ({
          id: owner.id || index,
          name: owner.owner_name || owner.name || '',
          email: owner.owner_email || owner.email || '',
          phone: owner.owner_phone || owner.phone || '',
          ownershipShare: owner.ownership_share || owner.ownershipShare || 0,
          role: owner.role || 'Co-Founder',
          verified: true // Already saved means verified
        }));
        setCoOwners(mappedCoOwners);
      }
    }
  }, [editingProfile]);

  const handleSearchUsers = async (query) => {
    setEmailSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearchingUsers(true);
    try {
      const results = await searchICANUsers(query);
      setSearchResults(results);
    } catch (error) {
      console.error('Error searching users:', error);
      setSearchResults([]);
    } finally {
      setSearchingUsers(false);
    }
  };

  const handleSelectUser = async (user) => {
    // Auto-fill user information from search result
    const updatedOwner = {
      ...newOwner,
      name: user.name || '',
      email: user.email || '',
      // Keep existing phone if not provided by search
      phone: user.phone || newOwner.phone,
      // Set default ownership share if not already set
      ownershipShare: newOwner.ownershipShare || 0
    };
    
    setNewOwner(updatedOwner);
    
    // Verify the user and update status
    const verification = await verifyICANUser(user.email);
    if (verification.exists) {
      setVerificationStatus(prev => ({
        ...prev,
        [user.email]: { exists: true }
      }));
      console.log(`✅ User verified: ${user.name} (${user.email})`);
    }
    
    // Clear search UI
    setSearchResults([]);
    setEmailSearchQuery('');
  };

  const handleEmailChange = async (e) => {
    const email = e.target.value;
    setNewOwner(prev => ({ ...prev, email }));
    
    // Auto-verify email when user stops typing
    if (email && email.includes('@')) {
      const verification = await verifyICANUser(email);
      setVerificationStatus(prev => ({
        ...prev,
        [email]: verification
      }));
    }
  };

  const addCoOwner = async () => {
    if (!newOwner.email) {
      alert('Please select or enter a co-owner email');
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newOwner.email)) {
      alert('Please enter a valid email address (e.g., user@example.com)');
      return;
    }

    // Check if email already added
    if (coOwners.some(owner => owner.email === newOwner.email)) {
      alert('This user is already a co-owner');
      return;
    }

    if (!newOwner.name) {
      alert('Please enter co-owner name');
      return;
    }

    if (newOwner.ownershipShare <= 0) {
      alert('Ownership share must be greater than 0');
      return;
    }

    if (totalShare + newOwner.ownershipShare > 100) {
      alert(`Total ownership would be ${totalShare + newOwner.ownershipShare}%. Cannot exceed 100%`);
      return;
    }

    // Check if user is verified
    let isVerified = verificationStatus[newOwner.email]?.exists;
    if (!isVerified) {
      const verification = await verifyICANUser(newOwner.email);
      if (!verification.exists) {
        alert(verification.error || 'Co-owner must have an ICAN account');
        return;
      }
    }

    // Add the co-owner
    setCoOwners([
      ...coOwners,
      {
        id: Date.now(),
        ...newOwner,
        verified: true
      }
    ]);

    // Clear the form
    setNewOwner({
      name: '',
      email: '',
      phone: '',
      ownershipShare: 0,
      role: 'Co-Founder',
      verified: false
    });
    setEmailSearchQuery('');
    setSearchResults([]);
    
    console.log('✅ Co-owner added successfully');
  };

  const updateCoOwner = (id, field, value) => {
    setCoOwners(coOwners.map(owner =>
      owner.id === id ? { ...owner, [field]: value } : owner
    ));
  };

  const removeCoOwner = (id) => {
    if (coOwners.length > 1) {
      setCoOwners(coOwners.filter(owner => owner.id !== id));
    }
  };

  const handleBusinessChange = (field, value) => {
    setBusinessData({
      ...businessData,
      [field]: value
    });
  };

  const handleCreateProfile = async () => {
    if (!businessData.businessName) {
      alert('Please fill in business name');
      return;
    }

    if (coOwners.length === 0) {
      alert('Please add at least one co-owner with ownership share');
      return;
    }

    // Check that all owners have names and emails
    for (const owner of coOwners) {
      if (!owner.name || !owner.email) {
        alert('All co-owners must have a name and email');
        return;
      }
    }

    if (totalShare !== 100) {
      alert(`Ownership shares must total exactly 100%. Currently: ${totalShare}%`);
      return;
    }

    if (coOwners.length > 5) {
      alert('Maximum 5 co-owners allowed');
      return;
    }

    // Validate wallet PIN
    if (!walletData.pin) {
      alert('Please set a wallet PIN for the business account');
      return;
    }

    if (walletData.pin !== walletData.confirmPin) {
      alert('PIN and Confirm PIN do not match');
      return;
    }

    if (!/^\d{4,6}$/.test(walletData.pin)) {
      alert('PIN must be 4-6 digits');
      return;
    }

    // Verify all co-owners have ICAN accounts
    for (const owner of coOwners) {
      if (!owner.verified) {
        const verification = await verifyICANUser(owner.email);
        if (!verification.exists) {
          alert(`Co-owner ${owner.email} must have an ICAN account first`);
          return;
        }
      }
    }

    setLoading(true);
    try {
      const profile = {
        business_name: businessData.businessName,
        business_type: businessData.businessType,
        registration_number: businessData.registrationNumber,
        tax_id: businessData.taxId,
        website: businessData.website,
        description: businessData.description,
        business_address: businessData.businessAddress,
        founded_year: businessData.foundedYear,
        total_capital: businessData.totalCapital ? parseInt(businessData.totalCapital) : 0,
        status: 'active',
        verification_status: 'pending'
      };

      let result;
      
      console.log('🔍 Checking mode - editingProfile:', !!editingProfile, 'ID:', editingProfile?.id);
      
      if (editingProfile?.id) {
        // Update existing profile (without co-owners - they're a separate table)
        console.log('📝 Updating profile:', editingProfile.id);
        result = await updateBusinessProfile(editingProfile.id, profile);
        
        if (result.success && result.data) {
          // Now save co-owners
          console.log('👥 Saving co-owners...');
          const coOwnersResult = await saveBusinessCoOwners(result.data.id, coOwners);
          
          if (coOwnersResult.success) {
            const updatedProfile = {
              id: result.data.id,
              ...result.data,
              business_co_owners: coOwners
            };
            console.log('✅ Profile and co-owners update complete');
            alert('✅ Profile updated successfully!');
            onProfileCreated(updatedProfile);
          } else {
            alert('Profile updated but failed to save co-owners: ' + coOwnersResult.error);
          }
        } else {
          alert('Failed to update profile: ' + (result.error || 'Unknown error'));
        }
      } else {
        // Create new profile
        console.log('✨ Creating new profile');
        result = await createBusinessProfile(userId, { user_id: userId, ...profile });
        
        if (result.success && result.data) {
          // Now save co-owners
          console.log('👥 Saving co-owners...');
          const coOwnersResult = await saveBusinessCoOwners(result.data.id, coOwners);
          
          if (coOwnersResult.success) {
            // 💳 Create wallet account for business
            console.log('💳 Creating business wallet account...');
            const walletAccountResult = await walletAccountService.createBusinessWalletAccount({
              businessId: result.data.id,
              businessName: businessData.businessName,
              userId: userId,
              accountHolderName: businessData.businessName,
              phoneNumber: coOwners[0]?.phone || '',
              email: coOwners[0]?.email || '',
              pin: walletData.pin,
              preferredCurrency: walletData.preferredCurrency,
              biometrics: { enabled: false }
            });

            if (walletAccountResult.success) {
              console.log('✅ Business wallet account created:', walletAccountResult.data.accountNumber);
              const createdProfile = {
                id: result.data.id,
                ...profile,
                business_co_owners: coOwners,
                wallet_account: walletAccountResult.data
              };
              alert('✅ Profile and business wallet account created successfully!');
              onProfileCreated(createdProfile);
            } else {
              // Profile created but wallet creation failed
              console.warn('⚠️ Profile created but wallet account failed:', walletAccountResult.error);
              const createdProfile = {
                id: result.data.id,
                ...profile,
                business_co_owners: coOwners
              };
              alert('Profile created! Note: Wallet account creation had an issue. You can set it up later.');
              onProfileCreated(createdProfile);
            }
          } else {
            alert('Profile created but failed to save co-owners: ' + coOwnersResult.error);
          }
        } else {
          alert('Failed to create profile: ' + (result.error || 'Unknown error'));
        }
      }
    } catch (error) {
      console.error('Error saving profile:', error);
      alert('Error saving profile: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl max-w-2xl w-full max-h-[95vh] overflow-y-auto border border-slate-700">
        {/* Header */}
        <div className="sticky top-0 bg-slate-900 border-b border-slate-700 p-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <Building2 className="w-6 h-6 text-blue-400" />
            {editingProfile ? 'Edit Business Profile' : 'Create Business Profile'}
          </h2>
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-white transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6">
          {/* Step Indicator */}
          <div className="flex gap-2 mb-8">
            {['business', 'owners', 'wallet', 'review'].map((s, idx) => (
              <button
                key={s}
                onClick={() => setStep(s)}
                className={`flex-1 py-2 px-4 rounded-lg font-semibold transition text-sm ${
                  step === s
                    ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {idx + 1}. {['Business Info', 'Co-Owners', 'Wallet', 'Review'][idx]}
              </button>
            ))}
          </div>

          {/* Step 1: Business Information */}
          {step === 'business' && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-white">Business Information</h3>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-slate-300 text-sm block mb-2">Business Name *</label>
                  <input
                    type="text"
                    value={businessData.businessName}
                    onChange={(e) => handleBusinessChange('businessName', e.target.value)}
                    placeholder="e.g., TechStartup Inc."
                    className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-slate-300 text-sm block mb-2">Business Type *</label>
                  <select
                    value={businessData.businessType}
                    onChange={(e) => handleBusinessChange('businessType', e.target.value)}
                    className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select type...</option>
                    <option value="LLC">LLC</option>
                    <option value="Corporation">Corporation</option>
                    <option value="Partnership">Partnership</option>
                    <option value="Sole Proprietorship">Sole Proprietorship</option>
                    <option value="Non-profit">Non-profit</option>
                  </select>
                </div>

                <div>
                  <label className="text-slate-300 text-sm block mb-2">Founded Year</label>
                  <input
                    type="number"
                    value={businessData.foundedYear}
                    onChange={(e) => handleBusinessChange('foundedYear', parseInt(e.target.value))}
                    placeholder="2024"
                    className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-slate-300 text-sm block mb-2">Registration Number</label>
                  <input
                    type="text"
                    value={businessData.registrationNumber}
                    onChange={(e) => handleBusinessChange('registrationNumber', e.target.value)}
                    placeholder="e.g., REG123456"
                    className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-slate-300 text-sm block mb-2">Tax ID</label>
                  <input
                    type="text"
                    value={businessData.taxId}
                    onChange={(e) => handleBusinessChange('taxId', e.target.value)}
                    placeholder="e.g., EIN: 12-3456789"
                    className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-slate-300 text-sm block mb-2">Total Capital</label>
                  <input
                    type="number"
                    value={businessData.totalCapital}
                    onChange={(e) => handleBusinessChange('totalCapital', e.target.value)}
                    placeholder="e.g., 100000"
                    className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="col-span-2">
                  <label className="text-slate-300 text-sm block mb-2">Business Address</label>
                  <input
                    type="text"
                    value={businessData.businessAddress}
                    onChange={(e) => handleBusinessChange('businessAddress', e.target.value)}
                    placeholder="e.g., 123 Main St, San Francisco, CA 94105"
                    className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="col-span-2">
                  <label className="text-slate-300 text-sm block mb-2">Website</label>
                  <input
                    type="url"
                    value={businessData.website}
                    onChange={(e) => handleBusinessChange('website', e.target.value)}
                    placeholder="https://example.com"
                    className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="col-span-2">
                  <label className="text-slate-300 text-sm block mb-2">Business Description</label>
                  <textarea
                    value={businessData.description}
                    onChange={(e) => handleBusinessChange('description', e.target.value)}
                    placeholder="Describe your business..."
                    rows="4"
                    className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600 focus:border-blue-500 focus:outline-none resize-none"
                  />
                </div>
              </div>

              <button
                onClick={() => setStep('owners')}
                className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white py-3 rounded-lg font-semibold transition"
              >
                Next: Add Co-Owners
              </button>
            </div>
          )}

          {/* Step 2: Co-Owners */}
          {step === 'owners' && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Users className="w-6 h-6" />
                Co-Owners & Ownership Structure
              </h3>

              <div className="bg-blue-900/20 border border-blue-500/30 p-4 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-blue-300 font-semibold">Total Ownership</p>
                    <p className={`text-sm mt-1 ${totalShare === 100 ? 'text-green-400' : 'text-blue-400'}`}>
                      Current: {totalShare}% {totalShare === 100 && '✓'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-blue-300 font-semibold">Co-Owners</p>
                    <p className="text-blue-400 text-sm mt-1">{coOwners.length} / 5</p>
                  </div>
                </div>
              </div>

              {/* Current Co-Owners */}
              <div className="space-y-3">
                <h4 className="text-white font-semibold">Current Co-Owners</h4>
                {coOwners.length === 0 ? (
                  <div className="bg-slate-700/50 p-4 rounded-lg border border-slate-600 text-slate-400 text-center">
                    No co-owners added yet. Use the form below to add them.
                  </div>
                ) : (
                  coOwners.map((owner) => (
                    <div key={owner.id} className="bg-slate-700 p-4 rounded-lg border border-slate-600">
                      <div className="grid grid-cols-2 gap-4 mb-3">
                        <div>
                          <label className="text-slate-300 text-xs block mb-1">Name</label>
                          <input
                            type="text"
                            value={owner.name}
                            onChange={(e) => updateCoOwner(owner.id, 'name', e.target.value)}
                            placeholder="Full name"
                            className="w-full bg-slate-600 text-white rounded px-3 py-2 border border-slate-500 focus:border-blue-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-slate-300 text-xs block mb-1">Email</label>
                          <input
                            type="email"
                            value={owner.email}
                            onChange={(e) => updateCoOwner(owner.id, 'email', e.target.value)}
                            placeholder="email@example.com"
                            className="w-full bg-slate-600 text-white rounded px-3 py-2 border border-slate-500 focus:border-blue-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="text-slate-300 text-xs block mb-1">Phone</label>
                          <input
                            type="tel"
                            value={owner.phone}
                            onChange={(e) => updateCoOwner(owner.id, 'phone', e.target.value)}
                            placeholder="+1 (555) 000-0000"
                            className="w-full bg-slate-600 text-white rounded px-3 py-2 border border-slate-500 focus:border-blue-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="text-slate-300 text-xs block mb-1">Role</label>
                          <select
                            value={owner.role}
                            onChange={(e) => updateCoOwner(owner.id, 'role', e.target.value)}
                            className="w-full bg-slate-600 text-white rounded px-3 py-2 border border-slate-500 focus:border-blue-500 focus:outline-none"
                          >
                            <option value="Founder">Founder</option>
                            <option value="Co-Founder">Co-Founder</option>
                            <option value="CTO">CTO</option>
                            <option value="CFO">CFO</option>
                            <option value="CEO">CEO</option>
                            <option value="Partner">Partner</option>
                            <option value="Investor">Investor</option>
                          </select>
                        </div>
                      </div>

                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <label className="text-slate-300 text-xs block mb-1">Ownership Share (%)</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={owner.ownershipShare}
                            onChange={(e) => updateCoOwner(owner.id, 'ownershipShare', parseInt(e.target.value) || 0)}
                            placeholder="0"
                            className="flex-1 bg-slate-600 text-white rounded px-3 py-2 border border-slate-500 focus:border-blue-500 focus:outline-none"
                          />
                          <span className="text-slate-400 text-sm font-semibold min-w-fit">
                            {owner.ownershipShare}%
                          </span>
                        </div>
                      </div>
                      {coOwners.length > 1 && (
                        <button
                          onClick={() => removeCoOwner(owner.id)}
                          className="text-red-400 hover:text-red-300 transition mt-6"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                    </div>
                  ))
                )}
              </div>

              {/* Add New Co-Owner */}
              {coOwners.length < 5 && (
                <div className="bg-slate-700/50 p-4 rounded-lg border border-slate-600">
                  <h4 className="text-white font-semibold mb-4">Add New Co-Owner (Must have ICAN Account)</h4>
                  <div className="space-y-4 mb-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-slate-300 text-xs block mb-1">Search ICAN User (by name or email)</label>
                        <div className="relative">
                          <div className="flex items-center gap-2 bg-slate-600 rounded px-3 py-2 border border-slate-500 focus-within:border-blue-500">
                            <Search className="w-4 h-4 text-slate-400" />
                            <input
                              type="text"
                              value={emailSearchQuery}
                              onChange={(e) => handleSearchUsers(e.target.value)}
                              onBlur={() => setTimeout(() => setSearchResults([]), 300)}
                              placeholder="Type name or email to search..."
                              className="flex-1 bg-transparent text-white outline-none placeholder-slate-400"
                              autoComplete="off"
                            />
                            {searchingUsers && (
                              <Loader className="w-4 h-4 text-blue-400 animate-spin" />
                            )}
                            {searchResults.length > 0 && (
                              <span className="text-green-400 text-xs">({searchResults.length} found)</span>
                            )}
                          </div>
                          
                          {/* Search Results Dropdown */}
                          {searchResults.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-slate-700 border border-blue-500 rounded shadow-lg z-20 max-h-48 overflow-y-auto">
                              <div className="px-3 py-2 bg-slate-800 text-slate-400 text-xs border-b border-slate-600">
                                👆 Click to select and auto-fill
                              </div>
                              {searchResults.map(user => (
                                <button
                                  key={user.email}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => handleSelectUser(user)}
                                  className="w-full text-left px-3 py-2 hover:bg-blue-600/30 text-white border-b border-slate-600 last:border-b-0 transition flex items-center justify-between"
                                >
                                  <div>
                                    <p className="font-medium">{user.name}</p>
                                    <p className="text-xs text-slate-400">{user.email}</p>
                                  </div>
                                  <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                                </button>
                              ))}
                            </div>
                          )}

                          {/* No results message */}
                          {emailSearchQuery.length >= 2 && searchResults.length === 0 && !searchingUsers && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-slate-700 border border-orange-500 rounded shadow-lg z-20 p-3">
                              <p className="text-orange-300 text-sm">⚠️ No ICAN users found matching "{emailSearchQuery}"</p>
                              <p className="text-slate-400 text-xs mt-1">The person must have an ICAN account first.</p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="text-slate-300 text-xs block mb-1">
                          Full Name {newOwner.name && <span className="text-green-400">✓ Auto-filled</span>}
                        </label>
                        <div className="flex items-center gap-2 bg-slate-600 rounded px-3 py-2 border border-slate-500">
                          <input
                            type="text"
                            value={newOwner.name}
                            readOnly
                            placeholder="← Search and select a user first"
                            className="flex-1 bg-transparent text-white outline-none placeholder-slate-400 cursor-not-allowed"
                          />
                          {newOwner.email && verificationStatus[newOwner.email]?.exists && (
                            <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Show selected user email */}
                    {newOwner.email && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-blue-900/30 rounded border border-blue-500/50">
                        <span className="text-blue-300 text-sm">📧 Selected: <strong>{newOwner.email}</strong></span>
                        <button
                          onClick={() => {
                            setNewOwner({ name: '', email: '', phone: '', ownershipShare: 0, role: 'Co-Founder', verified: false });
                            setEmailSearchQuery('');
                          }}
                          className="ml-auto text-red-400 hover:text-red-300 text-xs"
                        >
                          ✕ Clear
                        </button>
                      </div>
                    )}

                    {/* Verification Status */}
                    {newOwner.email && verificationStatus[newOwner.email] && (
                      <div className={`flex items-center gap-2 px-3 py-2 rounded ${
                        verificationStatus[newOwner.email]?.exists 
                          ? 'bg-green-900/30 text-green-300' 
                          : 'bg-red-900/30 text-red-300'
                      }`}>
                        {verificationStatus[newOwner.email]?.exists ? (
                          <>
                            <CheckCircle2 className="w-4 h-4" />
                            <span className="text-sm">✓ ICAN account verified - Ready to add!</span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="w-4 h-4" />
                            <span className="text-sm text-xs">{verificationStatus[newOwner.email]?.error}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <select
                      value={newOwner.role}
                      onChange={(e) => setNewOwner({...newOwner, role: e.target.value})}
                      className="bg-slate-600 text-white rounded px-3 py-2 border border-slate-500 focus:border-blue-500 focus:outline-none text-sm"
                    >
                      <option value="Founder">Founder</option>
                      <option value="Co-Founder">Co-Founder</option>
                      <option value="CTO">CTO</option>
                      <option value="CFO">CFO</option>
                      <option value="CEO">CEO</option>
                      <option value="Partner">Partner</option>
                    </select>

                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={newOwner.ownershipShare}
                      onChange={(e) => setNewOwner({...newOwner, ownershipShare: parseInt(e.target.value) || 0})}
                      placeholder="Ownership %"
                      className="bg-slate-600 text-white rounded px-3 py-2 border border-slate-500 focus:border-blue-500 focus:outline-none text-sm"
                    />

                    <button
                      onClick={addCoOwner}
                      disabled={!newOwner.name || !newOwner.email || !newOwner.ownershipShare}
                      title={
                        !newOwner.name ? 'Enter co-owner name' :
                        !newOwner.email ? 'Select or enter email' :
                        !newOwner.ownershipShare ? 'Enter ownership percentage' :
                        ''
                      }
                      className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded px-4 py-2 font-semibold transition flex items-center justify-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Add
                    </button>
                  </div>

                  {!newOwner.ownershipShare && newOwner.name && newOwner.email && (
                    <p className="text-yellow-400 text-sm">⚠️ Please enter ownership percentage to enable Add button</p>
                  )}

                  {totalShare + newOwner.ownershipShare > 100 && (
                    <p className="text-red-400 text-sm">⚠️ Total ownership would exceed 100%</p>
                  )}
                </div>
              )}

              <div className="flex gap-4">
                <button
                  onClick={() => setStep('business')}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-lg font-semibold transition"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep('wallet')}
                  className="flex-1 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white py-3 rounded-lg font-semibold transition"
                >
                  Next: Setup Wallet
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Wallet Account Setup */}
          {step === 'wallet' && (
            <div className="space-y-6">
              <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Wallet className="w-5 h-5 text-blue-400 flex-shrink-0 mt-1" />
                  <div>
                    <h4 className="text-white font-semibold mb-1">💳 Business Wallet Account</h4>
                    <p className="text-slate-300 text-sm">Create a dedicated ICAN wallet account for your business. This is required for receiving pitch earnings, payments, and managing finances.</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-slate-300 text-sm block mb-2">Preferred Currency</label>
                  <select
                    value={walletData.preferredCurrency}
                    onChange={(e) => setWalletData({...walletData, preferredCurrency: e.target.value})}
                    className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="UGX">🇺🇬 UGX (Ugandan Shilling)</option>
                    <option value="KES">🇰🇪 KES (Kenyan Shilling)</option>
                    <option value="USD">🇺🇸 USD (US Dollar)</option>
                    <option value="EUR">🇪🇺 EUR (Euro)</option>
                  </select>
                </div>

                <div className="bg-slate-700/50 p-4 rounded-lg border border-slate-600">
                  <h4 className="text-white font-semibold mb-4">🔐 Wallet PIN (4-6 digits)</h4>
                  <p className="text-slate-400 text-xs mb-4">The PIN will be required for all wallet transactions and sensitive operations.</p>
                  
                  <div className="space-y-3">
                    <div>
                      <label className="text-slate-300 text-xs block mb-2">PIN</label>
                      <div className="flex items-center">
                        <input
                          type={walletData.showPin ? 'text' : 'password'}
                          value={walletData.pin}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
                            setWalletData({...walletData, pin: val});
                          }}
                          maxLength="6"
                          placeholder="Enter 4-6 digits"
                          className="flex-1 bg-slate-600 text-white rounded-lg px-4 py-2 border border-slate-500 focus:border-blue-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setWalletData({...walletData, showPin: !walletData.showPin})}
                          className="ml-2 text-slate-400 hover:text-slate-200 text-sm"
                        >
                          {walletData.showPin ? '🙈 Hide' : '👁️ Show'}
                        </button>
                      </div>
                      {walletData.pin && (
                        <div className="text-xs text-slate-400 mt-1">
                          Strength: {walletData.pin.length < 4 ? '⚠️ Too short' : walletData.pin.length < 6 ? '✓ Good' : '✓✓ Strong'}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="text-slate-300 text-xs block mb-2">Confirm PIN</label>
                      <input
                        type={walletData.showPin ? 'text' : 'password'}
                        value={walletData.confirmPin}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
                          setWalletData({...walletData, confirmPin: val});
                        }}
                        maxLength="6"
                        placeholder="Confirm PIN"
                        className="w-full bg-slate-600 text-white rounded-lg px-4 py-2 border border-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                      {walletData.pin && walletData.confirmPin && (
                        <div className={`text-xs mt-1 ${walletData.pin === walletData.confirmPin ? 'text-green-400' : 'text-red-400'}`}>
                          {walletData.pin === walletData.confirmPin ? '✓ PINs match' : '✗ PINs do not match'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Wallet Account Summary */}
                <div className="bg-slate-700/30 p-3 rounded-lg border border-slate-600">
                  <p className="text-slate-300 text-xs">
                    <span className="font-semibold">Account Holder:</span> {businessData.businessName}<br />
                    <span className="font-semibold">Currency:</span> {walletData.preferredCurrency}<br />
                    <span className="font-semibold">PIN Set:</span> {walletData.pin ? '✓ Yes' : '✗ No'}
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => setStep('owners')}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-lg font-semibold transition"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep('review')}
                  disabled={!walletData.pin || walletData.pin !== walletData.confirmPin || !/^\d{4,6}$/.test(walletData.pin)}
                  className="flex-1 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 disabled:from-slate-600 disabled:to-slate-600 disabled:cursor-not-allowed text-white py-3 rounded-lg font-semibold transition"
                >
                  Review & Create
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {step === 'review' && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold text-white">Review Your Business Profile</h3>

              <div className="bg-gradient-to-br from-blue-900/30 to-cyan-900/30 border border-blue-500/30 p-6 rounded-lg space-y-4">
                <div>
                  <p className="text-slate-400 text-sm">Business Name</p>
                  <p className="text-white font-bold text-lg">{businessData.businessName}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-slate-400 text-sm">Type</p>
                    <p className="text-white font-semibold">{businessData.businessType}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-sm">Founded</p>
                    <p className="text-white font-semibold">{businessData.foundedYear}</p>
                  </div>
                </div>
                {businessData.website && (
                  <div>
                    <p className="text-slate-400 text-sm">Website</p>
                    <p className="text-blue-400 font-semibold break-all">{businessData.website}</p>
                  </div>
                )}
                {businessData.businessAddress && (
                  <div>
                    <p className="text-slate-400 text-sm">Address</p>
                    <p className="text-white font-semibold">{businessData.businessAddress}</p>
                  </div>
                )}
                {businessData.description && (
                  <div>
                    <p className="text-slate-400 text-sm">Description</p>
                    <p className="text-slate-300 text-sm">{businessData.description}</p>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <h4 className="text-white font-bold flex items-center gap-2">
                  <PieChart className="w-5 h-5 text-blue-400" />
                  Ownership Structure ({totalShare}%)
                </h4>
                {coOwners.length === 0 ? (
                  <div className="bg-slate-700/50 p-4 rounded-lg border border-slate-600 text-slate-400 text-center">
                    No co-owners added. You cannot save without at least one co-owner.
                  </div>
                ) : (
                  coOwners.map((owner) => (
                    <div key={owner.id} className="bg-slate-700/50 p-4 rounded-lg border border-slate-600">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-white font-semibold">{owner.name}</p>
                          <p className="text-slate-400 text-sm">{owner.role} • {owner.email}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-blue-400 font-bold text-lg">{owner.ownershipShare}%</p>
                        </div>
                      </div>
                      <div className="w-full bg-slate-600 rounded-full h-2">
                        <div
                          className="bg-gradient-to-r from-blue-500 to-cyan-500 h-2 rounded-full"
                          style={{ width: `${owner.ownershipShare}%` }}
                        ></div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {totalShare !== 100 && (
                <div className="bg-red-900/30 border border-red-500/50 p-4 rounded-lg">
                  <p className="text-red-300">
                    ⚠️ Ownership shares must total 100%. Currently: {totalShare}%
                  </p>
                </div>
              )}

              {coOwners.length === 0 && (
                <div className="bg-red-900/30 border border-red-500/50 p-4 rounded-lg">
                  <p className="text-red-300">
                    ⚠️ Please add at least one co-owner
                  </p>
                </div>
              )}

              <div className="flex gap-4">
                <button
                  onClick={() => setStep('owners')}
                  disabled={loading}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-700 text-white py-3 rounded-lg font-semibold transition"
                >
                  Back
                </button>
                <button
                  onClick={handleCreateProfile}
                  disabled={totalShare !== 100 || coOwners.length === 0 || loading}
                  className="flex-1 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:from-slate-600 disabled:to-slate-600 text-white py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2"
                >
                  {loading && <Loader className="w-4 h-4 animate-spin" />}
                  {loading ? 'Creating...' : 'Create Business Profile'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BusinessProfileForm;
