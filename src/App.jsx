import { useState, lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar/Navbar';
import Footer from './components/Footer/Footer';
import AuthModal from './components/AuthModal/AuthModal';

// Lazy load pages for performance
const Home = lazy(() => import('./pages/Home/Home'));
const Browse = lazy(() => import('./pages/Browse/Browse'));
const Schedule = lazy(() => import('./pages/Schedule/Schedule'));
const Bookmark = lazy(() => import('./pages/Bookmark/Bookmark'));
const AnimeDetail = lazy(() => import('./pages/AnimeDetail/AnimeDetail'));
const Streaming = lazy(() => import('./pages/Streaming/Streaming'));

function PageLoader() {
  return (
    <div className="page-loader">
      <div className="spinner"></div>
      <p className="page-loader-text">Loading</p>
    </div>
  );
}

function App() {
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <>
      <Navbar onShowAuth={() => setShowAuthModal(true)} />
      <main>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/browse" element={<Browse />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route
              path="/bookmarks"
              element={<Bookmark onShowAuth={() => setShowAuthModal(true)} />}
            />
            <Route path="/anime/:id" element={<AnimeDetail />} />
            <Route path="/watch/:id" element={<Streaming />} />
            <Route path="/watch/:id/:episode" element={<Streaming />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </>
  );
}

export default App;
