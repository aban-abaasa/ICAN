import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  collection, 
  addDoc, 
  getDocs, 
  updateDoc, 
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot
} from 'firebase/firestore';

// Firebase configuration - with fallback for missing credentials
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'sk_test_missing_api_key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'ican-engine.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'ican-engine',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'ican-engine.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '0',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:0:web:0'
};

// Check if Firebase is properly configured
const isFirebaseConfigured = import.meta.env.VITE_FIREBASE_API_KEY && 
                           import.meta.env.VITE_FIREBASE_PROJECT_ID;

if (!isFirebaseConfigured) {
  console.warn('⚠️ Firebase credentials not configured. Using Supabase auth instead.');
}

let app = null;
let auth = null;
let db = null;

try {
  // Initialize Firebase only if properly configured
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (error) {
  console.error('❌ Firebase initialization failed:', error);
  console.log('ℹ️ App will use Supabase authentication instead.');
}

// Authentication utilities
export const signInAnonymousUser = () => {
  if (!auth) {
    console.warn('⚠️ Firebase auth not configured');
    return Promise.reject(new Error('Firebase not configured'));
  }
  return signInAnonymously(auth);
};

export const onAuthStateChange = (callback) => {
  if (!auth) {
    console.warn('⚠️ Firebase auth not configured');
    return () => {}; // Return no-op unsubscribe function
  }
  return onAuthStateChanged(auth, callback);
};

// Export auth and db for use in other parts of the app
export { auth, db, app };

// Firestore utilities for ICAN Capital Engine
const COLLECTIONS = {
  USERS: 'users',
  TRANSACTIONS: 'transactions',
  CONTRACTS: 'contracts',
  COMPLIANCE: 'compliance',
  SCHEDULES: 'schedules'
};

// User data operations
export const createOrUpdateUser = async (userId, userData) => {
  if (!db) {
    console.warn('⚠️ Firebase not configured - skipping user update');
    return { success: true }; // Silently fail
  }
  try {
    const userRef = doc(db, COLLECTIONS.USERS, userId);
    await updateDoc(userRef, {
      ...userData,
      lastUpdated: new Date().toISOString()
    });
    return { success: true };
  } catch (error) {
    console.error('Error updating user:', error);
    return { success: false, error };
  }
};

export const getUserData = async (userId) => {
  if (!db) {
    console.warn('⚠️ Firebase not configured - skipping user fetch');
    return { success: true, data: {} };
  }
  try {
    const userRef = doc(db, COLLECTIONS.USERS, userId);
    const userDoc = await userRef.get();
    
    if (userDoc.exists()) {
      return { success: true, data: userDoc.data() };
    } else {
      return { success: false, error: 'User not found' };
    }
  } catch (error) {
    console.error('Error getting user data:', error);
    return { success: false, error };
  }
};

// Transaction operations (Pillar I: Financial Capital)
export const addTransaction = async (userId, transaction) => {
  try {
    const transactionData = {
      ...transaction,
      userId,
      createdAt: new Date().toISOString(),
      appId: 'ican-capital-engine'
    };
    
    const docRef = await addDoc(collection(db, COLLECTIONS.TRANSACTIONS), transactionData);
    return { success: true, id: docRef.id };
  } catch (error) {
    console.error('Error adding transaction:', error);
    return { success: false, error };
  }
};

export const getUserTransactions = async (userId) => {
  try {
    const q = query(
      collection(db, COLLECTIONS.TRANSACTIONS),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc')
    );
    
    const querySnapshot = await getDocs(q);
    const transactions = [];
    
    querySnapshot.forEach((doc) => {
      transactions.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    return { success: true, data: transactions };
  } catch (error) {
    console.error('Error getting transactions:', error);
    return { success: false, error };
  }
};

export const updateTransaction = async (transactionId, updates) => {
  try {
    const transactionRef = doc(db, COLLECTIONS.TRANSACTIONS, transactionId);
    await updateDoc(transactionRef, {
      ...updates,
      updatedAt: new Date().toISOString()
    });
    return { success: true };
  } catch (error) {
    console.error('Error updating transaction:', error);
    return { success: false, error };
  }
};

export const deleteTransaction = async (transactionId) => {
  try {
    await deleteDoc(doc(db, COLLECTIONS.TRANSACTIONS, transactionId));
    return { success: true };
  } catch (error) {
    console.error('Error deleting transaction:', error);
    return { success: false, error };
  }
};

// Contract analysis operations (Pillar II: Legal Resilience)
export const saveContractAnalysis = async (userId, contractData, analysis) => {
  try {
    const contractAnalysisData = {
      userId,
      contractText: contractData.text,
      analysis,
      createdAt: new Date().toISOString(),
      appId: 'ican-capital-engine'
    };
    
    const docRef = await addDoc(collection(db, COLLECTIONS.CONTRACTS), contractAnalysisData);
    return { success: true, id: docRef.id };
  } catch (error) {
    console.error('Error saving contract analysis:', error);
    return { success: false, error };
  }
};

export const getContractAnalyses = async (userId) => {
  try {
    const q = query(
      collection(db, COLLECTIONS.CONTRACTS),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc')
    );
    
    const querySnapshot = await getDocs(q);
    const contracts = [];
    
    querySnapshot.forEach((doc) => {
      contracts.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    return { success: true, data: contracts };
  } catch (error) {
    console.error('Error getting contract analyses:', error);
    return { success: false, error };
  }
};

// Compliance data operations (Pillar III: Regulatory Compliance)
export const saveComplianceCheck = async (userId, complianceData) => {
  try {
    const complianceCheckData = {
      userId,
      ...complianceData,
      createdAt: new Date().toISOString(),
      appId: 'ican-capital-engine'
    };
    
    const docRef = await addDoc(collection(db, COLLECTIONS.COMPLIANCE), complianceCheckData);
    return { success: true, id: docRef.id };
  } catch (error) {
    console.error('Error saving compliance check:', error);
    return { success: false, error };
  }
};

export const getLatestComplianceCheck = async (userId, country, mode) => {
  try {
    const q = query(
      collection(db, COLLECTIONS.COMPLIANCE),
      where('userId', '==', userId),
      where('country', '==', country),
      where('mode', '==', mode),
      orderBy('createdAt', 'desc')
    );
    
    const querySnapshot = await getDocs(q);
    
    if (!querySnapshot.empty) {
      const doc = querySnapshot.docs[0];
      return { 
        success: true, 
        data: {
          id: doc.id,
          ...doc.data()
        }
      };
    }
    
    return { success: false, error: 'No compliance data found' };
  } catch (error) {
    console.error('Error getting compliance check:', error);
    return { success: false, error };
  }
};

// Schedule optimization operations (Pillar IV: Human Capital)
export const saveScheduleOptimization = async (userId, scheduleData) => {
  try {
    const scheduleOptimizationData = {
      userId,
      ...scheduleData,
      createdAt: new Date().toISOString(),
      appId: 'ican-capital-engine'
    };
    
    const docRef = await addDoc(collection(db, COLLECTIONS.SCHEDULES), scheduleOptimizationData);
    return { success: true, id: docRef.id };
  } catch (error) {
    console.error('Error saving schedule optimization:', error);
    return { success: false, error };
  }
};

export const getLatestScheduleOptimization = async (userId) => {
  try {
    const q = query(
      collection(db, COLLECTIONS.SCHEDULES),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc')
    );
    
    const querySnapshot = await getDocs(q);
    
    if (!querySnapshot.empty) {
      const doc = querySnapshot.docs[0];
      return { 
        success: true, 
        data: {
          id: doc.id,
          ...doc.data()
        }
      };
    }
    
    return { success: false, error: 'No schedule data found' };
  } catch (error) {
    console.error('Error getting schedule optimization:', error);
    return { success: false, error };
  }
};

// Real-time listeners
export const subscribeToTransactions = (userId, callback) => {
  const q = query(
    collection(db, COLLECTIONS.TRANSACTIONS),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc')
  );
  
  return onSnapshot(q, (querySnapshot) => {
    const transactions = [];
    querySnapshot.forEach((doc) => {
      transactions.push({
        id: doc.id,
        ...doc.data()
      });
    });
    callback(transactions);
  });
};

// Firestore data structure paths for reference:
// /collections/artifacts/{appId}/users/{userId}/
//   - profile: { mode, operatingCountry, goals, preferences }
//   - transactions: [{ amount, type, description, date, category }]
//   - contracts: [{ text, analysis, safetyScore, liabilityFlags }]
//   - compliance: [{ country, mode, checklist, compliancePercentage }]
//   - schedules: [{ optimizationScore, recommendations, nextActions }]

export default {
  auth,
  db,
  signInAnonymousUser,
  onAuthStateChange,
  createOrUpdateUser,
  getUserData,
  addTransaction,
  getUserTransactions,
  updateTransaction,
  deleteTransaction,
  saveContractAnalysis,
  getContractAnalyses,
  saveComplianceCheck,
  getLatestComplianceCheck,
  saveScheduleOptimization,
  getLatestScheduleOptimization,
  subscribeToTransactions
};