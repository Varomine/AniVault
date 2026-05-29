// Bookmark Service — Firebase Firestore
import { doc, setDoc, deleteDoc, getDoc, getDocs, collection, query, where, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

const BOOKMARKS_COLLECTION = 'bookmarks';

function getUserBookmarksRef(userId) {
  return collection(db, 'users', userId, BOOKMARKS_COLLECTION);
}

function getBookmarkDocRef(userId, animeId) {
  return doc(db, 'users', userId, BOOKMARKS_COLLECTION, String(animeId));
}

export async function addBookmark(userId, anime, category = 'Plan to Watch') {
  try {
    const docRef = getBookmarkDocRef(userId, anime.mal_id);
    await setDoc(docRef, {
      mal_id: anime.mal_id,
      title: anime.title || anime.title_english || '',
      title_english: anime.title_english || '',
      title_japanese: anime.title_japanese || '',
      image: anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || '',
      score: anime.score || 0,
      type: anime.type || '',
      episodes: anime.episodes || 0,
      status: anime.status || '',
      genres: (anime.genres || []).map(g => g.name),
      category,
      addedAt: Date.now(),
    });
    return true;
  } catch (error) {
    console.error('Failed to add bookmark:', error);
    return false;
  }
}

export async function removeBookmark(userId, animeId) {
  try {
    const docRef = getBookmarkDocRef(userId, animeId);
    await deleteDoc(docRef);
    return true;
  } catch (error) {
    console.error('Failed to remove bookmark:', error);
    return false;
  }
}

export async function isBookmarked(userId, animeId) {
  try {
    const docRef = getBookmarkDocRef(userId, animeId);
    const snap = await getDoc(docRef);
    return snap.exists();
  } catch (error) {
    return false;
  }
}

export async function getBookmarks(userId, category = null) {
  try {
    const ref = getUserBookmarksRef(userId);
    let q;
    if (category && category !== 'All') {
      q = query(ref, where('category', '==', category));
    } else {
      q = ref;
    }
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Failed to get bookmarks:', error);
    return [];
  }
}

export async function updateBookmarkCategory(userId, animeId, category) {
  try {
    const docRef = getBookmarkDocRef(userId, animeId);
    await updateDoc(docRef, { category });
    return true;
  } catch (error) {
    console.error('Failed to update bookmark category:', error);
    return false;
  }
}

// Local storage fallback for non-authenticated users
const LOCAL_KEY = 'anivault_bookmarks';

export function getLocalBookmarks() {
  try {
    const data = localStorage.getItem(LOCAL_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function addLocalBookmark(anime, category = 'Plan to Watch') {
  const bookmarks = getLocalBookmarks();
  const exists = bookmarks.find(b => b.mal_id === anime.mal_id);
  if (exists) return;
  bookmarks.push({
    mal_id: anime.mal_id,
    title: anime.title || '',
    image: anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || '',
    score: anime.score || 0,
    type: anime.type || '',
    episodes: anime.episodes || 0,
    status: anime.status || '',
    category,
    addedAt: Date.now(),
  });
  localStorage.setItem(LOCAL_KEY, JSON.stringify(bookmarks));
}

export function removeLocalBookmark(animeId) {
  const bookmarks = getLocalBookmarks().filter(b => b.mal_id !== animeId);
  localStorage.setItem(LOCAL_KEY, JSON.stringify(bookmarks));
}

export function isLocalBookmarked(animeId) {
  return getLocalBookmarks().some(b => b.mal_id === animeId);
}
