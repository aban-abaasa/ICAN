/**
 * 🌍 Country Setup Component (Minimal Dropdown)
 * Required during first login if country not set
 * Compact dropdown for quick country selection
 */

import React, { useState, useEffect, useRef } from 'react';
import { CountryService } from '../../services/countryService';
import useCountry from '../../hooks/useCountry';
import './CountrySetup.css';

export default function CountrySetup({ onCountrySet, isModal = false, isMandatory = false }) {
  const { updateCountry } = useCountry();
  const [isOpen, setIsOpen] = useState(true);
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef(null);
  const searchInputRef = useRef(null);
  
  // Debugging
  useEffect(() => {
    console.log('CountrySetup mounted. isOpen:', isOpen, 'isMandatory:', isMandatory);
  }, []);
  
  const [countries] = useState(() => {
    // Get all countries from all regions worldwide
    const allCountries = Object.entries(CountryService.getCountries())
      .map(([code, data]) => ({
        code,
        ...data,
        icanCoinRate: CountryService.icanToLocal(1, code).toFixed(2)
      }))
      .sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically
    
    console.log(`📍 Loaded ${allCountries.length} countries worldwide`);
    return allCountries;
  });

  // Handle outside clicks to close dropdown (unless mandatory)
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isMandatory) return; // Don't close on outside click if mandatory
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, isMandatory]);

  // Prevent keyboard escape when it's mandatory
  useEffect(() => {
    if (!isMandatory) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMandatory]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current && !loading) {
      searchInputRef.current.focus();
    }
  }, [isOpen, loading]);

  const handleSelectCountry = async (countryCode) => {
    try {
      setLoading(true);
      setError('');
      console.log('🌍 Selecting country:', countryCode);

      const result = await updateCountry(countryCode);

      if (result.success) {
        console.log('✅ Country saved successfully');
        setSuccess(true);
        setSelectedCountry(countryCode);
        setIsOpen(false);
        
        setTimeout(() => {
          if (onCountrySet) {
            onCountrySet(countryCode);
          }
        }, 800);
      } else {
        console.error('❌ Failed to save country:', result.error);
        setError(result.error || 'Failed to set country');
      }
    } catch (err) {
      console.error('❌ Error selecting country:', err);
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const country = selectedCountry ? CountryService.getCountry(selectedCountry) : null;
  const filteredCountries = countries.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (success && country) {
    return (
      <div className="country-setup-minimal">
        <div className="success-checkmark">
          <div className="checkmark">✓</div>
          <p>{country.name}</p>
          <p style={{fontSize: '14px', color: 'rgba(255,255,255,0.8)', marginTop: '8px'}}>
            {country.currency} • {country.icanCoinRate} per ICAN
          </p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`country-dropdown-wrapper ${isMandatory ? 'mandatory' : ''}`}
      ref={dropdownRef}
    >
      <div className="dropdown-container">
        <div className="dropdown-header">
          <button 
            className={`dropdown-toggle ${isOpen ? 'open' : ''}`}
            onClick={() => {
              console.log('🔘 Toggle clicked. Current isOpen:', isOpen);
              !loading && setIsOpen(!isOpen);
            }}
            disabled={loading}
            title="Click to select your country"
            aria-label="Toggle country selection dropdown"
            aria-expanded={isOpen}
          >
            <span className="flag-icon">🌍</span>
            <span className="header-text">Set Your Base Currency</span>
            <span className={`chevron ${isOpen ? 'open' : ''}`}>▼</span>
          </button>
        </div>

        {error && (
          <div className="dropdown-error">
            <span style={{marginRight: '8px'}}>❌</span>
            {error}
          </div>
        )}

        {isOpen && !loading && (
          <div className="dropdown-content" style={{display: 'block', visibility: 'visible', opacity: 1}}>
            <div className="search-box">
              <input 
                ref={searchInputRef}
                type="text"
                placeholder="🔍 Search country..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                disabled={loading}
                autoComplete="off"
                aria-label="Search countries"
              />
            </div>

            <div className="countries-list">
              {filteredCountries.length > 0 ? (
                filteredCountries.map(c => (
                  <button
                    key={c.code}
                    onClick={() => handleSelectCountry(c.code)}
                    disabled={loading}
                    className="country-item"
                    title={`Select ${c.name}`}
                    aria-label={`${c.name} - ${c.currency}`}
                  >
                    <span className="country-flag">{c.flag}</span>
                    <span className="country-info">
                      <span className="country-name">{c.name}</span>
                      <span className="country-rate">{c.currency} - 1 ICAN = {c.icanCoinRate}</span>
                    </span>
                    {loading && <span className="spinner-mini"></span>}
                  </button>
                ))
              ) : (
                <div className="no-results">
                  <p>No countries found</p>
                  <p style={{fontSize: '12px', color: '#999', marginTop: '4px'}}>Try a different search</p>
                </div>
              )}
            </div>
          </div>
        )}

        {loading && isOpen && (
          <div className="loading-indicator">
            <div className="spinner-mini"></div>
            <span>Saving country...</span>
          </div>
        )}
      </div>
    </div>
  );
}
