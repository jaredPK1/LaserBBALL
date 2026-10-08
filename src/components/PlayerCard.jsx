export default function PlayerCard({ player, onAdd, showAddButton }) {
  return (
    <div style={styles.card}>
      <div style={styles.info}>
        <span style={styles.name}>{player.name}</span>
        <span className="pos-badge">{player.position}</span>
        <span style={styles.team} className="stat">{player.team}</span>
      </div>
      <div style={styles.stats} className="stat">
        {player.stats && Object.entries(player.stats).slice(0, 3).map(([k, v]) => (
          <span key={k} style={styles.statItem}>
            <span style={{ color: 'var(--text2)', fontSize: 10 }}>{k}</span>{' '}
            {typeof v === 'number' ? v.toFixed(1) : v}
          </span>
        ))}
      </div>
      <div style={styles.right}>
        {player.ownership != null && (
          <span className="stat" style={{ color: 'var(--text2)', fontSize: 12 }}>
            {player.ownership}% owned
          </span>
        )}
        {showAddButton && (
          <button className="btn btn-primary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => onAdd?.(player)}>
            Add
          </button>
        )}
      </div>
    </div>
  );
}

const styles = {
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '12px 16px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 6,
  },
  info: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 200,
  },
  name: {
    fontWeight: 500,
    fontSize: 14,
  },
  team: {
    fontSize: 12,
    color: 'var(--text2)',
  },
  stats: {
    display: 'flex',
    gap: 16,
    flex: 1,
  },
  statItem: {
    fontSize: 13,
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginLeft: 'auto',
  },
};
