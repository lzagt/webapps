import React, { useState } from 'react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  FacebookAuthProvider, 
  OAuthProvider 
} from 'firebase/auth';
import { auth } from '../../../lib/firebase';

interface LoginProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export const Login: React.FC<LoginProps> = ({ onSuccess, onCancel }) => {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const handleSignIn = async (providerName: 'google' | 'facebook' | 'microsoft') => {
    setError(null);
    setLoading(providerName);
    try {
      let provider;
      if (providerName === 'google') {
        provider = new GoogleAuthProvider();
      } else if (providerName === 'facebook') {
        provider = new FacebookAuthProvider();
      } else {
        provider = new OAuthProvider('microsoft.com');
      }

      await signInWithPopup(auth, provider);
      if (onSuccess) {
        onSuccess();
      }
    } catch (err: any) {
      console.error(`${providerName} login failed:`, err);
      setError(err.message || 'Authentication failed. Please try again.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="login-modal-overlay">
      <div className="glass-panel login-card border-accent animate-fade-in">
        <div className="login-header">
          <div className="icon-badge">
            <span className="material-symbols-outlined text-gradient">shield_person</span>
          </div>
          <h2 className="text-gradient">Parent Portal Access</h2>
          <p>Please authenticate to access calendar configuration and settings.</p>
        </div>

        {error && (
          <div className="alert alert-danger" style={{ margin: '12px 0', fontSize: '13px' }}>
            <span className="material-symbols-outlined" style={{ marginRight: '6px', fontSize: '16px' }}>error</span>
            {error}
          </div>
        )}

        <div className="login-actions">
          <button 
            className="btn btn-login btn-google" 
            disabled={loading !== null}
            onClick={() => handleSignIn('google')}
          >
            <span className="btn-icon">
              {loading === 'google' ? (
                <div className="spinner"></div>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              )}
            </span>
            <span>Sign in with Google</span>
          </button>

          <button 
            className="btn btn-login btn-facebook" 
            disabled={loading !== null}
            onClick={() => handleSignIn('facebook')}
          >
            <span className="btn-icon">
              {loading === 'facebook' ? (
                <div className="spinner"></div>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                </svg>
              )}
            </span>
            <span>Sign in with Facebook</span>
          </button>

          <button 
            className="btn btn-login btn-microsoft" 
            disabled={loading !== null}
            onClick={() => handleSignIn('microsoft')}
          >
            <span className="btn-icon">
              {loading === 'microsoft' ? (
                <div className="spinner"></div>
              ) : (
                <svg viewBox="0 0 23 23" width="18" height="18" fill="currentColor">
                  <path d="M0 0h11v11H0z" fill="#f25022"/>
                  <path d="M12 0h11v11H12z" fill="#7fba00"/>
                  <path d="M0 12h11v11H0z" fill="#00a4ef"/>
                  <path d="M12 12h11v11H12z" fill="#ffb900"/>
                </svg>
              )}
            </span>
            <span>Sign in with Microsoft</span>
          </button>
        </div>

        {onCancel && (
          <button 
            className="btn btn-secondary" 
            style={{ marginTop: '16px', width: '100%' }}
            disabled={loading !== null}
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};
