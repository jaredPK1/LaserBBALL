export default function PageHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h1 style={{ fontSize: 36, color: 'var(--text)' }}>{title}</h1>
      {subtitle && (
        <p style={{ color: 'var(--text2)', fontSize: 14, marginTop: 4 }}>{subtitle}</p>
      )}
    </div>
  );
}
