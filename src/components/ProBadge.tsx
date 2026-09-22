import '@styles/ProBadge.scss';

// The one "this is a Pro feature" mark (spec §8.2): information, not a lock —
// never greyed out, no padlock.
const ProBadge: React.FC = () => <span className="pro-badge">Pro</span>;

export default ProBadge;
