import { Link } from 'react-router-dom';
import './Footer.css';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="footer-inner">
        {/* Brand */}
        <Link to="/" className="footer-brand">
          MioAnime
        </Link>

        {/* Copy */}
        <span className="footer-copy">
          &copy; {currentYear} MioAnime. All rights reserved.
        </span>
      </div>
    </footer>
  );
}
