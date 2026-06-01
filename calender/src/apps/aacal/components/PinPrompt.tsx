import React, { useState } from 'react';

interface PinPromptProps {
  correctPin: string;
  onVerify: () => void;
  title: string;
  onCancel?: () => void;
}

export const PinPrompt: React.FC<PinPromptProps> = ({ correctPin, onVerify, title, onCancel }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === correctPin) {
      onVerify();
    } else {
      setError(true);
      setPin('');
      // Reset error after animation
      setTimeout(() => setError(false), 500);
    }
  };

  return (
    <div className="pin-overlay" style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      background: 'rgba(9, 13, 22, 0.85)',
      backdropFilter: 'blur(16px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '20px'
    }}>
      <div className={`glass-card ${error ? 'shake' : ''}`} style={{
        maxWidth: '400px',
        width: '100%',
        padding: '32px',
        borderRadius: '24px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        background: 'rgba(30, 41, 59, 0.7)',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        textAlign: 'center'
      }}>
        <div style={{
          width: '64px',
          height: '64px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #a78bfa 0%, #8b5cf6 50%, #6d28d9 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 20px',
          boxShadow: '0 0 20px rgba(139, 92, 246, 0.25)'
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: '32px', color: '#fff' }}>lock</span>
        </div>

        <h2 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '24px', fontWeight: 700, margin: '0 0 8px 0', color: '#fff' }}>
          {title}
        </h2>
        <p style={{ fontSize: '14px', color: '#94a3b8', margin: '0 0 24px 0' }}>
          Please enter the parent-configured PIN to continue.
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '24px' }}>
            <input
              type="password"
              maxLength={8}
              placeholder="••••"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              style={{
                width: '100%',
                fontSize: '28px',
                textAlign: 'center',
                letterSpacing: '12px',
                padding: '12px',
                borderRadius: '16px',
                border: error ? '2px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(15, 23, 42, 0.6)',
                color: '#fff',
                fontFamily: 'monospace',
                outline: 'none',
                transition: 'all 0.2s'
              }}
              autoFocus
            />
            {error && (
              <p style={{ color: '#ef4444', fontSize: '12px', marginTop: '8px', fontWeight: 500 }}>
                Incorrect PIN. Please try again.
              </p>
            )}
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="btn-link"
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '14px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              className="btn-link btn-save"
              style={{
                flex: 2,
                padding: '12px',
                borderRadius: '14px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              Verify PIN
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
