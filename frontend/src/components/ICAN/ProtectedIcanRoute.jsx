/**
 * 🛡️ Protected ICAN Route
 * Ensures user has selected a country before accessing ICAN features
 */

import React from 'react';
import useCountry from '../../hooks/useCountry';
import CountrySetup from '../auth/CountrySetup';

export default function ProtectedIcanRoute({ children, redirectTo = '/dashboard' }) {
  const { country, loading, hasCountry } = useCountry();

  // Still loading
  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading your profile...</p>
        </div>
      </div>
    );
  }

  // Country not set - show setup screen
  if (!hasCountry()) {
    return (
      <CountrySetup
        isModal={true}
        onCountrySet={() => {
          // Reload to update country state
          window.location.reload();
        }}
      />
    );
  }

  // Country is set - render protected content
  return children;
}

/* Loading Container Styles */
const styles = `
  .loading-container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  }

  .loading-spinner {
    text-align: center;
    color: white;
  }

  .spinner {
    width: 50px;
    height: 50px;
    border: 4px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin: 0 auto 20px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .loading-spinner p {
    font-size: 16px;
    margin: 0;
  }
`;

export { styles as loadingStyles };
