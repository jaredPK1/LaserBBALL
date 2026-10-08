import { Link } from 'react-router-dom';
import { startAuth, clearTokens } from '../api/yahoo';

export default function Connect({ authed }) {

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>HOOP INTEL</h1>
      <p style={styles.subtitle}>Fantasy Basketball Intelligence</p>

      {authed ? (
        <div style={styles.statusBox}>
          <div style={{ color: 'var(--green)', fontFamily: "'DM Mono', monospace", marginBottom: 16 }}>
            Connected to Yahoo Fantasy
          </div>
          <Link className="btn btn-primary" to="/gamenight" style={{ marginRight: 8 }}>Open Game Night</Link>
          <button
            className="btn btn-ghost"
            onClick={async () => { await clearTokens(); window.location.reload(); }}
          >
            Disconnect
          </button>
        </div>
      ) : (
        <>
          <button className="btn btn-primary" style={styles.connectBtn} onClick={startAuth}>
            Connect Yahoo Fantasy
          </button>
          <Link to="/draft" style={{ marginTop: 24, color: 'var(--text2)', fontSize: 14 }}>
            Open the draft board without connecting →
          </Link>
        </>
      )}
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    width: '100%',
    padding: 24,
    textAlign: 'center',
  },
  title: {
    fontSize: 'clamp(44px, 12vw, 72px)',
    color: 'var(--accent)',
    letterSpacing: '0.1em',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: 'var(--text2)',
    marginBottom: 48,
  },
  connectBtn: {
    fontSize: 18,
    padding: '16px 40px',
    borderRadius: 8,
  },
  statusBox: {
    textAlign: 'center',
  },
};
