import { useState, useEffect, useRef } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { Search, Menu, X, User, LogOut, Bookmark as BookmarkIcon } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { searchAnime } from '../../services/jikanApi';
import './Navbar.css';

export default function Navbar({ onShowAuth }) {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);

  const dropdownRef = useRef(null);
  const searchRef = useRef(null);
  const searchTimerRef = useRef(null);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setDropdownOpen(false);
      if (searchRef.current && !searchRef.current.contains(e.target)) setShowSearchResults(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleResize = () => { if (window.innerWidth > 768) setMobileOpen(false); };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Realtime search with debounce
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const q = searchQuery.trim();
    if (q.length < 2) {
      Promise.resolve().then(() => {
        setSearchResults([]);
        setShowSearchResults(false);
      });
      return;
    }
    Promise.resolve().then(() => {
      setSearchLoading(true);
      setShowSearchResults(true);
    });
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await searchAnime({ q, limit: 6, sfw: true });
        setSearchResults(res?.data || []);
      } catch (err) {
        console.error('Search error:', err);
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 400);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (trimmed) {
      navigate(`/browse?q=${encodeURIComponent(trimmed)}`);
      setSearchQuery('');
      setShowSearchResults(false);
      setMobileOpen(false);
    }
  };

  const handleResultClick = (malId) => {
    navigate(`/anime/${malId}`);
    setSearchQuery('');
    setShowSearchResults(false);
    setMobileOpen(false);
  };

  const handleLogout = async () => {
    await logout();
    setDropdownOpen(false);
  };

  const closeMobile = () => setMobileOpen(false);

  const navItems = [
    { label: 'Home', to: '/' },
    { label: 'Browse', to: '/browse' },
    { label: 'Schedule', to: '/schedule' },
    { label: 'Bookmarks', to: '/bookmarks' },
  ];

  const getInitial = () => {
    if (user?.displayName) return user.displayName.charAt(0).toUpperCase();
    if (user?.email) return user.email.charAt(0).toUpperCase();
    return 'U';
  };

  return (
    <>
      <nav className={`navbar${scrolled ? ' scrolled' : ''}`}>
        <Link to="/" className="nav-logo">
          <span className="nav-logo-text">AniVault</span>
        </Link>

        <div className="nav-links">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              {item.label}
            </NavLink>
          ))}
        </div>

        <div className="nav-right">
          {/* Realtime Search */}
          <div className="nav-search-wrapper" ref={searchRef}>
            <form className="nav-search" onSubmit={handleSearchSubmit}>
              <input type="text" placeholder="Search anime..." value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => { if (searchQuery.trim().length >= 2) setShowSearchResults(true); }} />
              <Search size={16} className="nav-search-icon" />
            </form>

            {showSearchResults && (
              <div className="nav-search-dropdown">
                {searchLoading ? (
                  <div className="nav-search-loading">
                    <div className="spinner" style={{ width: 20, height: 20 }} />
                    <span>Searching...</span>
                  </div>
                ) : searchResults.length > 0 ? (
                  <>
                    {searchResults.map((item) => (
                      <div key={item.mal_id} className="nav-search-result" onClick={() => handleResultClick(item.mal_id)}>
                        <img src={item.images?.jpg?.small_image_url || ''} alt={item.title} className="nav-search-result-img" />
                        <div className="nav-search-result-info">
                          <span className="nav-search-result-title">{item.title_english || item.title}</span>
                          <span className="nav-search-result-meta">
                            {item.type}{item.episodes ? ` • ${item.episodes} eps` : ''}{item.score ? ` • ★ ${item.score}` : ''}
                          </span>
                        </div>
                      </div>
                    ))}
                    <button type="button" className="nav-search-view-all" onClick={handleSearchSubmit}>
                      View all results for &ldquo;{searchQuery}&rdquo;
                    </button>
                  </>
                ) : (
                  <div className="nav-search-no-results">No results found</div>
                )}
              </div>
            )}
          </div>

          {/* User Section */}
          {isAuthenticated ? (
            <div className="nav-user" ref={dropdownRef}>
              <button className="nav-avatar" onClick={() => setDropdownOpen(!dropdownOpen)} aria-label="User menu">
                {user?.photoURL ? <img src={user.photoURL} alt={user.displayName || 'User'} /> : getInitial()}
              </button>
              {dropdownOpen && (
                <div className="nav-dropdown">
                  <div className="nav-dropdown-item" style={{ pointerEvents: 'none', opacity: 0.7 }}>
                    <User size={15} /><span>{user?.displayName || user?.email || 'User'}</span>
                  </div>
                  <div className="nav-dropdown-divider" />
                  <button className="nav-dropdown-item" onClick={() => { navigate('/bookmarks'); setDropdownOpen(false); }}>
                    <BookmarkIcon size={15} /><span>Bookmarks</span>
                  </button>
                  <div className="nav-dropdown-divider" />
                  <button className="nav-dropdown-item danger" onClick={handleLogout}>
                    <LogOut size={15} /><span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="nav-signin-btn" onClick={onShowAuth}><User size={15} /> Sign In</button>
          )}

          <button className="nav-mobile-toggle" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle menu">
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </nav>

      <div className={`nav-menu-mobile${mobileOpen ? ' open' : ''}`}>
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            onClick={closeMobile}>
            {item.label}
          </NavLink>
        ))}
        <form className="nav-search" onSubmit={handleSearchSubmit}>
          <input type="text" placeholder="Search anime..." value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)} />
          <Search size={16} className="nav-search-icon" />
        </form>
      </div>
    </>
  );
}
