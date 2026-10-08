export default function CatBar({ category, myValue, theirValue }) {
  const myNum = parseFloat(myValue) || 0;
  const theirNum = parseFloat(theirValue) || 0;
  const total = myNum + theirNum || 1;
  const myPct = (myNum / total) * 100;
  const theirPct = (theirNum / total) * 100;

  // For TO (turnovers), lower is better
  const isTO = category.toUpperCase() === 'TO';
  const iWin = isTO ? myNum < theirNum : myNum > theirNum;
  const isTied = myNum === theirNum;

  const myColor = isTied ? 'var(--muted)' : iWin ? 'var(--green)' : 'var(--red)';
  const theirColor = isTied ? 'var(--muted)' : iWin ? 'var(--red)' : 'var(--green)';

  return (
    <div style={styles.row}>
      <div style={styles.value} className="stat">
        <span style={{ color: myColor, fontWeight: 600 }}>{formatVal(myNum, category)}</span>
      </div>
      <div style={styles.barContainer}>
        <div style={styles.barWrapper}>
          <div style={{ ...styles.barLeft, width: `${myPct}%`, background: myColor }} />
          <div style={{ ...styles.barRight, width: `${theirPct}%`, background: theirColor }} />
        </div>
        <div style={styles.catLabel} className="stat">{category}</div>
      </div>
      <div style={{ ...styles.value, textAlign: 'right' }} className="stat">
        <span style={{ color: theirColor, fontWeight: 600 }}>{formatVal(theirNum, category)}</span>
      </div>
    </div>
  );
}

function formatVal(val, cat) {
  if (cat === 'FG%' || cat === 'FT%') return val.toFixed(3);
  if (Number.isInteger(val)) return val;
  return val.toFixed(1);
}

const styles = {
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 0',
    borderBottom: '1px solid var(--border)',
  },
  value: {
    width: 60,
    fontSize: 13,
    fontFamily: "'DM Mono', monospace",
  },
  barContainer: {
    flex: 1,
    position: 'relative',
  },
  barWrapper: {
    display: 'flex',
    height: 20,
    borderRadius: 4,
    overflow: 'hidden',
    background: 'var(--surface2)',
  },
  barLeft: {
    height: '100%',
    transition: 'width 0.3s ease',
    borderRadius: '4px 0 0 4px',
    opacity: 0.7,
  },
  barRight: {
    height: '100%',
    transition: 'width 0.3s ease',
    borderRadius: '0 4px 4px 0',
    opacity: 0.7,
  },
  catLabel: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: 10,
    color: 'var(--text)',
    fontWeight: 600,
    textShadow: '0 1px 3px rgba(0,0,0,0.8)',
  },
};
