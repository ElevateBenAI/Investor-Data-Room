import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, deleteDoc, doc, query, orderBy, getDoc, setDoc, getDocs } from 'firebase/firestore';

// Main App component
const App = () => {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [userRole, setUserRole] = useState('loading'); // 'loading', 'admin', 'investor'
  const [files, setFiles] = useState([]);
  const [fileName, setFileName] = useState('');
  const [fileUrl, setFileUrl] = useState(''); // Corrected: Initialized with useState('')
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalMessage, setModalMessage] = useState(''); // Corrected: Initialized with useState('')

  // Firebase Initialization and Authentication
  useEffect(() => {
    try {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');

      if (!Object.keys(firebaseConfig).length) {
        setError("Firebase configuration is missing. Please ensure '__firebase_config' is provided.");
        setLoading(false);
        return;
      }

      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const firebaseAuth = getAuth(app);

      setDb(firestore);
      setAuth(firebaseAuth);

      const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        if (user) {
          setUserId(user.uid);
          setIsAuthReady(true);
        } else {
          try {
            // Attempt to sign in with custom token if available
            if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
              await signInWithCustomToken(firebaseAuth, __initial_auth_token);
            } else {
              // Fallback to anonymous sign-in if no custom token
              await signInAnonymously(firebaseAuth);
            }
          } catch (authError) {
            console.error("Firebase authentication error:", authError);
            setError(`Authentication failed: ${authError.message}`);
          }
          setIsAuthReady(true); // Auth state checked, ready to proceed
        }
        setLoading(false);
      });

      return () => unsubscribe(); // Cleanup auth listener
    } catch (e) {
      console.error("Error initializing Firebase:", e);
      setError(`Failed to initialize Firebase: ${e.message}`);
      setLoading(false);
    }
  }, []);

  // Fetch and set user role
  useEffect(() => {
    const assignUserRole = async () => {
      if (!db || !userId || !isAuthReady) return;

      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      // Updated path for user_roles to follow public data convention
      const userRoleDocRef = doc(db, `artifacts/${appId}/public/data/user_roles`, userId);
      const userRoleDocSnap = await getDoc(userRoleDocRef);

      if (userRoleDocSnap.exists()) {
        setUserRole(userRoleDocSnap.data().role);
      } else {
        // If user role doesn't exist, check if any admin exists
        // Updated path for user_roles to follow public data convention
        const rolesCollectionRef = collection(db, `artifacts/${appId}/public/data/user_roles`);
        const q = query(rolesCollectionRef);
        const querySnapshot = await getDocs(q); // Use getDocs to check for existing roles

        let isAdminPresent = false;
        querySnapshot.forEach(doc => {
          if (doc.data().role === 'admin') {
            isAdminPresent = true;
          }
        });

        const newRole = isAdminPresent ? 'investor' : 'admin';
        await setDoc(userRoleDocRef, { role: newRole, timestamp: Date.now() });
        setUserRole(newRole);
      }
    };

    if (isAuthReady && db && userId) {
      assignUserRole();
    }
  }, [db, userId, isAuthReady]); // Depend on db, userId, and isAuthReady

  // Fetch files when db, userId, and userRole are ready
  useEffect(() => {
    if (db && userId && userRole !== 'loading') { // Ensure userRole is loaded
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const filesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/files`);
      // Note: orderBy is commented out as per instructions to avoid potential index issues.
      // Data will be sorted client-side if needed.
      const q = query(filesCollectionRef); // , orderBy('timestamp', 'desc')

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const fetchedFiles = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        // Client-side sorting by timestamp (newest first)
        fetchedFiles.sort((a, b) => b.timestamp - a.timestamp);
        setFiles(fetchedFiles);
      }, (err) => {
        console.error("Error fetching files:", err);
        setError(`Failed to load files: ${err.message}`);
      });

      return () => unsubscribe(); // Cleanup snapshot listener
    }
  }, [db, userId, userRole]); // Add userRole to dependencies

  // Function to show custom modal messages
  const showCustomModal = (message) => {
    setModalMessage(message);
    setShowModal(true);
  };

  // Handle adding a new file entry
  const handleAddFile = async () => {
    if (userRole !== 'admin') {
      showCustomModal('Permission denied. Only administrators can add files.');
      return;
    }

    if (!fileName.trim() || !fileUrl.trim()) {
      showCustomModal('Please enter both file name and a valid URL.');
      return;
    }
    if (!db || !userId) {
      showCustomModal('Database not ready. Please try again.');
      return;
    }

    try {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      await addDoc(collection(db, `artifacts/${appId}/users/${userId}/files`), {
        name: fileName.trim(),
        url: fileUrl.trim(),
        timestamp: Date.now(),
        uploaderId: userId,
      });
      setFileName('');
      setFileUrl('');
      showCustomModal('File entry added successfully!');
    } catch (e) {
      console.error("Error adding document: ", e);
      showCustomModal(`Error adding file: ${e.message}`);
    }
  };

  // Handle deleting a file entry
  const handleDeleteFile = async (fileId) => {
    if (userRole !== 'admin') {
      showCustomModal('Permission denied. Only administrators can delete files.');
      return;
    }

    if (!db || !userId) {
      showCustomModal('Database not ready. Please try again.');
      return;
    }

    // Using window.confirm for simplicity, replace with custom modal for production
    if (window.confirm('Are you sure you want to delete this file entry?')) {
      try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/files`, fileId));
        showCustomModal('File entry deleted successfully!');
      } catch (e) {
        console.error("Error deleting document: ", e);
        showCustomModal(`Error deleting file: ${e.message}`);
      }
    }
  };

  if (loading || userRole === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-xl font-semibold text-gray-700">Loading Virtual Data Room...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-red-100 text-red-800 p-4 rounded-lg">
        <p className="text-lg font-medium">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#00193A] to-[#3DA5D9] font-sans text-gray-800 p-4 sm:p-6 md:p-8 flex flex-col items-center">
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Custom Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-sm w-full text-center">
            <p className="text-lg mb-4">{modalMessage}</p>
            <button
              onClick={() => setShowModal(false)}
              className="px-6 py-2 bg-[#1D68E5] text-white rounded-md hover:bg-blue-700 transition duration-300 shadow-md"
            >
              OK
            </button>
          </div>
        </div>
      )}

      <div className="w-full max-w-4xl bg-white rounded-xl shadow-2xl p-6 sm:p-8 md:p-10 mb-8">
        {/* Elevate Innovations Logo */}
        <div className="flex justify-center mb-6">
          <img
            src="https://i.imgur.com/HtCyaCR.png" // Updated Logo URL
            alt="Elevate Innovations Logo"
            className="h-24 sm:h-32 object-contain"
            onError={(e) => { e.target.onerror = null; e.target.src = "https://placehold.co/150x75/E0E0E0/000000?text=Logo"; }}
          />
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold text-center text-[#00193A] mb-6">
          Elevate Innovations Data Room
        </h1>
        <p className="text-center text-[#282828] mb-8">
          Welcome, <span className="font-semibold text-[#1D68E5] break-all">{userId}</span>!
          <br />
          Your role: <span className="font-semibold text-[#1D68E5] capitalize">{userRole}</span>.
          <br />
          Manage and share your investor documents here.
        </p>

        {/* BenAI Image */}
        <div className="flex justify-center mb-8">
          <img
            src="https://i.imgur.com/0Tf0IXb.png" // BenAI image URL
            alt="BenAI"
            className="h-48 sm:h-64 object-contain rounded-lg shadow-md"
            onError={(e) => { e.target.onerror = null; e.target.src = "https://placehold.co/150x150/E0E0E0/000000?text=BenAI"; }}
          />
        </div>

        {/* Add New File Section (Admin only) */}
        {userRole === 'admin' && (
          <div className="mb-8 p-6 bg-[#EBF4FA] rounded-lg shadow-inner"> {/* Light blue background */}
            <h2 className="text-2xl font-semibold text-[#00193A] mb-4">Add New Document Link</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input
                type="text"
                placeholder="Document Name (e.g., Q2 2024 Report)"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                className="p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#1D68E5] focus:border-[#1D68E5] transition duration-200 w-full"
              />
              <input
                type="url"
                placeholder="External Document URL (e.g., Google Drive link)"
                value={fileUrl}
                onChange={(e) => setFileUrl(e.target.value)}
                className="p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#1D68E5] focus:border-[#1D68E5] transition duration-200 w-full"
              />
            </div>
            <button
              onClick={handleAddFile}
              className="mt-6 w-full bg-[#1D68E5] text-white py-3 rounded-lg font-semibold text-lg hover:bg-[#00193A] transition duration-300 shadow-lg transform hover:scale-105"
            >
              Add Document Link
            </button>
          </div>
        )}

        {/* File List Section */}
        <div className="p-6 bg-white rounded-lg shadow-lg">
          <h2 className="text-2xl font-semibold text-[#00193A] mb-4">Your Documents</h2>
          {files.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No documents added yet. Start by adding a new one above!</p>
          ) : (
            <ul className="space-y-4">
              {files.map((file) => (
                <li
                  key={file.id}
                  className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 bg-gray-50 rounded-lg shadow-sm border border-gray-200 hover:bg-gray-100 transition duration-200"
                >
                  <div className="flex-1 mb-2 sm:mb-0 sm:mr-4">
                    <p className="text-lg font-medium text-gray-900">{file.name}</p>
                    <p className="text-sm text-gray-500 break-all">{file.url}</p>
                  </div>
                  <div className="flex space-x-2">
                    {userRole === 'admin' && ( // Only show download and delete for admin
                      <>
                        <a
                          href={file.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-4 py-2 bg-[#0BFB23] text-white rounded-md hover:bg-green-600 transition duration-300 shadow-md flex items-center"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                          Download
                        </a>
                        <button
                          onClick={() => handleDeleteFile(file.id)}
                          className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition duration-300 shadow-md flex items-center"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm6 0a1 1 0 11-2 0v6a1 1 0 112 0V8z" clipRule="evenodd" />
                          </svg>
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
