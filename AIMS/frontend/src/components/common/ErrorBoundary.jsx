import React from 'react';

/**
 * Catches a render error anywhere below it and shows a recovery screen.
 *
 * This boundary wraps the whole application, so before this change a single
 * throw on any page of any portal replaced the entire app with the error
 * screen, and it stayed there: the only ways out were a full reload or the
 * "Choose Portal" button, because nothing ever reset `hasError`. Navigating
 * away from the broken page could not clear it, which is why one bad tab made
 * the portal look permanently broken.
 *
 * `resetKey` fixes that. App.jsx passes the current pathname, so moving to a
 * different route clears the error and re-renders the children. A page that
 * genuinely throws every time will simply show the screen again; one that
 * threw transiently recovers on the next navigation.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#0F172A',
          color: '#FFFFFF',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          fontFamily: "'Inter', sans-serif",
          textAlign: 'center',
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '16px',
            backgroundColor: '#DC2626',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.8rem',
            marginBottom: '1.5rem',
            boxShadow: '0 10px 25px rgba(220, 38, 38, 0.4)',
          }}>
            ⚠️
          </div>

          <h1 style={{ fontSize: '1.8rem', fontWeight: 800, fontFamily: "'Outfit', sans-serif", margin: '0 0 0.5rem' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: '0.95rem', color: '#94A3B8', maxWidth: '480px', margin: '0 0 2rem', lineHeight: 1.6 }}>
            {this.state.error?.message || 'An unexpected error occurred while loading this page.'}
          </p>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.href = '/choose-portal';
              }}
              style={{
                padding: '0.75rem 1.5rem',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: '#DC2626',
                color: '#FFFFFF',
                fontSize: '0.9rem',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(220,38,38,0.3)',
              }}
            >
              Choose Portal
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '0.75rem 1.5rem',
                borderRadius: '10px',
                border: '1px solid #334155',
                backgroundColor: '#1E293B',
                color: '#F8FAFC',
                fontSize: '0.9rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
