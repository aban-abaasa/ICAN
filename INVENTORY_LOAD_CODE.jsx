// ADD THIS CODE TO CMSSModule.jsx - loadCompanyData function
// Insert AFTER line 568 (after departments loading) and BEFORE line 569 (catch block)

      // Fetch inventory items from Supabase (source of truth)
      const { data: inventoryItems, error: inventoryError } = await cmmsService.getCompanyInventory(companyIdToUse);
      if (!inventoryError) {
        console.log(`✅ Loaded ${inventoryItems?.length || 0} inventory items from Supabase`);
        setCmmsData(prev => ({
          ...prev,
          inventory: inventoryItems || []
        }));
      } else {
        console.error('❌ Error loading inventory from Supabase:', inventoryError);
      }
