import { supabase } from '../lib/supabase/client';

// Nearest-supplier locations and BodaGoera delivery for CMMS supplier orders.
// Backed by CMMS_SUPPLIER_NEAREST_AND_BODAGOERA_DELIVERY.sql. Every call
// returns { data, error } and never throws, so the ordering panel keeps
// working (without distances / delivery) if that SQL has not been run yet.

const wrap = async (call) => {
  try {
    const { data, error } = await call();
    return { data: error ? null : data, error: error || null };
  } catch (error) {
    return { data: null, error };
  }
};

export const getSupplierLocations = (companyId) =>
  wrap(() => supabase.rpc('cmms_get_supplier_locations', { p_company_id: companyId }));

export const setCompanyDeliveryPoint = (companyId, { latitude, longitude, address }) =>
  wrap(() => supabase.rpc('cmms_set_company_delivery_point', {
    p_company_id: companyId,
    p_latitude: latitude,
    p_longitude: longitude,
    p_address: address || null
  }));

// Live BodaGoera quote for one vehicle type ('motorcycle' | 'van' | 'truck' | 'car').
export const quoteDelivery = (pickup, dropoff, vehicleType) =>
  wrap(() => supabase.rpc('cmms_quote_delivery', {
    p_pickup_lat: pickup.latitude,
    p_pickup_lng: pickup.longitude,
    p_dropoff_lat: dropoff.latitude,
    p_dropoff_lng: dropoff.longitude,
    p_vehicle_type: vehicleType
  }));

export const requestSupplierOrderDelivery = (orderId, vehicleType, dropoff) =>
  wrap(() => supabase.rpc('cmms_request_supplier_order_delivery', {
    p_order_id: orderId,
    p_vehicle_type: vehicleType,
    p_dropoff_lat: dropoff.latitude,
    p_dropoff_lng: dropoff.longitude,
    p_dropoff_address: dropoff.address
  }));

export const getCurrentPosition = () =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This device does not support location.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => reject(new Error('Could not get your location. Allow location access and try again.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });
