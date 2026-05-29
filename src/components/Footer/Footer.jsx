import { Link } from 'react-router-dom';
import './Footer.css';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="footer-inner">
        {/* Brand */}
        <Link to="/" className="footer-brand">
          AniVault
        </Link>

        {/* Links */}
        <nav className="footer-links">
          <Link to="/" className="footer-link">Home</Link>
          <Link to="/browse" className="footer-link">Browse</Link>
          <Link to="/schedule" className="footer-link">Schedule</Link>
        </nav>

        {/* Info */}
        <div className="footer-info">
          <span className="footer-powered">
            Powered by Jikan API &amp; AniList
          </span>
          <span className="footer-copy">
            &copy; {currentYear} AniVault. All rights reserved.
          </span>
        </div>
      </div>
    </footer>
  );
}
