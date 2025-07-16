import React, { useState, useEffect, useRef } from 'react'; // Added useRef
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, deleteDoc, doc, query, getDoc, setDoc, getDocs } from 'firebase/firestore';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage'; // NEW: Firebase Storage imports

// Main App component
const App = () => {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [userRole, setUserRole] = useState('loading'); // 'loading', 'admin', 'investor'
  const [files, setFiles] = useState([]);
  const [fileName, setFileName] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalMessage, setModalMessage] = useState('');
  const [showDocumentViewer, setShowDocumentViewer] = useState(false);
  const [documentToViewUrl, setDocumentToViewUrl] = useState('');
  const [documentToViewName, setDocumentToViewName] = useState('');
  const [isDragging, setIsDragging] = useState(false); // State for drag-and-drop visual feedback

  // NEW: State for file upload
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  // NEW: State for LLM insight feature
  const [llmInsight, setLlmInsight] = useState(null);
  const [isGeneratingInsight, setIsGeneratingInsight] = useState(false);
  const [showInsightModal, setShowInsightModal] = useState(false); // Used to control AI Insight modal visibility


  const dropZoneRef = useRef(null); // Ref for the drag-and-drop area


  // Define values for Firebase configuration when running locally.
  // These are your actual Firebase project's config details.
  // NOTE: When running in Canvas, __app_id, __firebase_config, and __initial_auth_token are provided.
  // For local development, these local* variables are used.
  const localAppId = 'elevate-data-room-local'; // A placeholder app ID for local development
const localFirebaseConfig = {
  apiKey: "AIzaSyAWtjdXc_ORZbE4-0GcCRC1xVMjF3NEeYg",
  authDomain: "investor-data-room-96aa7.firebaseapp.com",
  projectId: "investor-data-room-96aa7",
  storageBucket: "investor-data-room-96aa7.appspot.com",
  messagingSenderId: "255074366663",
  appId: "1:255074366663:web:13483dcdab8d1029fdfae2"
  };
  const localInitialAuthToken = null; // Placeholder for Canvas

  // Firebase Initialization and Authentication
  useEffect(() => {
    try {
      // Use the global Canvas variables if they exist, otherwise use local placeholders
      const currentAppId = typeof __app_id !== 'undefined' ? __app_id : localAppId; // Changed to currentAppId
      const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : localFirebaseConfig;
      const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : localInitialAuthToken;

      if (!Object.keys(firebaseConfig).length || !firebaseConfig.apiKey || !firebaseConfig.projectId) {
        setError("Firebase configuration is missing or incomplete. Please ensure '__firebase_config' is provided in Canvas or localFirebaseConfig is set.");
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
            if (initialAuthToken) {
              await signInWithCustomToken(firebaseAuth, initialAuthToken);
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
  }, [localFirebaseConfig]); // Added localFirebaseConfig to dependencies

  // Fetch and set user role
  useEffect(() => {
    const assignUserRole = async () => {
      if (!db || !userId || !isAuthReady) return;

      const currentAppId = typeof __app_id !== 'undefined' ? __app_id : localAppId; // Use currentAppId for Firestore path
      // Updated path for user_roles to follow public data convention
      const userRoleDocRef = doc(db, `artifacts/${currentAppId}/public/data/user_roles`, userId);
      const userRoleDocSnap = await getDoc(userRoleDocRef);

      if (userRoleDocSnap.exists()) {
        setUserRole(userRoleDocSnap.data().role);
      } else {
        // If user role doesn't exist, check if any admin exists
        // Updated path for user_roles to follow public data convention
        const rolesCollectionRef = collection(db, `artifacts/${currentAppId}/public/data/user_roles`);
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
  }, [db, userId, isAuthReady, localAppId]); // Added localAppId to dependencies

  // Fetch files when db, userId, and userRole are ready
  useEffect(() => {
    if (db && userId && userRole !== 'loading') { // Ensure userRole is loaded
      const currentAppId = typeof __app_id !== 'undefined' ? __app_id : localAppId; // Use currentAppId for Firestore path
      // CHANGE: Fetch from public collection
      const filesCollectionRef = collection(db, `artifacts/${currentAppId}/public/data/files`);
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
  }, [db, userId, userRole, localAppId]); // Added localAppId to dependencies

  // Drag and Drop Handlers
  useEffect(() => {
    const dropZone = dropZoneRef.current;
    if (!dropZone || userRole !== 'admin') return; // Only enable for admin

    const handleDragOver = (e) => {
      e.preventDefault(); // Prevent default to allow drop
      setIsDragging(true);
    };

    const handleDragLeave = (e) => {
      e.preventDefault();
      setIsDragging(false);
    };

    const handleDrop = (e) => {
      e.preventDefault();
      setIsDragging(false);
      const droppedFiles = e.dataTransfer.files;
      if (droppedFiles.length > 0) {
        // For simplicity, we'll take the first file's name
        setFileName(droppedFiles[0].name);
        setSelectedFile(droppedFiles[0]); // NEW: Set the selected file for upload
        showCustomModal(`File "${droppedFiles[0].name}" selected. Click "Upload File" to proceed.`);
      }
    };

    dropZone.addEventListener('dragover', handleDragOver);
    dropZone.addEventListener('dragleave', handleDragLeave);
    dropZone.addEventListener('drop', handleDrop);

    return () => {
      dropZone.removeEventListener('dragover', handleDragOver);
      dropZone.removeEventListener('dragleave', handleDragLeave);
      dropZone.removeEventListener('drop', handleDrop);
    };
  }, [userRole]); // Re-run effect if userRole changes

  // NEW: Handle file selection from input
  const handleFileChange = (e) => {
    if (e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
      setFileName(e.target.files[0].name);
      showCustomModal(`File "${e.target.files[0].name}" selected. Click "Upload File" to proceed.`);
    } else {
      setSelectedFile(null);
      setFileName('');
    }
  };

  // NEW: Handle file upload to Firebase Storage
  const handleFileUpload = async () => {
    if (!selectedFile) {
      showCustomModal('Please select a file first.');
      return;
    }
    if (!db || !userId || !auth) {
      showCustomModal('Firebase services not ready. Please try again.');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setError('');

    try {
      const storage = getStorage(); // Get Firebase Storage instance
      const currentAppId = typeof __app_id !== 'undefined' ? __app_id : localAppId;
      // Define storage path: artifacts/{appId}/files/{userId}/{filename}
      // This path is private to the uploader, but the URL will be public.
      const storageRef = ref(storage, `artifacts/${currentAppId}/files/${userId}/${selectedFile.name}`);
      const uploadTask = uploadBytesResumable(storageRef, selectedFile);

      uploadTask.on('state_changed',
        (snapshot) => {
          // Observe state change events such as progress, pause, and resume
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(progress);
        },
        (uploadError) => {
          // Handle unsuccessful uploads
          console.error("Upload error:", uploadError);
          setError(`File upload failed: ${uploadError.message}`);
          setIsUploading(false);
          showCustomModal(`File upload failed: ${uploadError.message}`);
        },
        async () => {
          // Handle successful uploads on complete
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          setFileUrl(downloadURL); // Set the obtained download URL
          setIsUploading(false);
          setUploadProgress(0);
          showCustomModal('File uploaded successfully! Now click "Add Document Link" to add it to the data room.');
        }
      );
    } catch (e) {
      console.error("Firebase Storage setup error:", e);
      setError(`Storage setup failed: ${e.message}`);
      setIsUploading(false);
      showCustomModal(`Storage setup failed: ${e.message}`);
    }
  };

  // NEW: Function to call Gemini API for document insight
  const generateDocumentInsight = async (docName) => {
    setIsGeneratingInsight(true);
    setLlmInsight(null); // Clear previous insight
    setModalMessage('Generating AI insights...');
    setShowModal(true); // Show modal with loading message

    const prompt = `Generate a concise, investor-friendly summary (max 3 sentences) and 3 key questions an investor might ask about a document titled "${docName}". Format as: "Summary: [summary text]\nKey Questions:\n- [Question 1]\n- [Question 2]\n- [Question 3]".`;

    try {
      const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
      // FIX: Robustly get API key for browser environment
      // Use __api_key if available (from Canvas), otherwise use REACT_APP_GEMINI_API_KEY from .env
      const apiKey = typeof __api_key !== 'undefined' ? __api_key : process.env.REACT_APP_GEMINI_API_KEY;
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      if (result.candidates && result.candidates.length > 0 &&
          result.candidates[0].content && result.candidates[0].content.parts &&
          result.candidates[0].content.parts.length > 0) {
        const text = result.candidates[0].content.parts[0].text;
        setLlmInsight(text);
        setModalMessage(text); // Update modal with insight
      } else {
        setModalMessage("Failed to generate insight. Please try again.");
      }
    } catch (e) {
      console.error("Gemini API call failed:", e);
      setModalMessage(`Error generating insight: ${e.message}`);
    } finally {
      setIsGeneratingInsight(false);
    }
  };

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
      const currentAppId = typeof __app_id !== 'undefined' ? __app_id : localAppId; // Use currentAppId for Firestore path
      // CHANGE: Add to public collection
      await addDoc(collection(db, `artifacts/${currentAppId}/public/data/files`), {
        name: fileName.trim(),
        url: fileUrl.trim(),
        timestamp: Date.now(),
        uploaderId: userId, // Store uploaderId to enforce write/delete rules
      });
      setFileName('');
      setFileUrl('');
      setSelectedFile(null); // Clear selected file after adding
      showCustomModal('Document link added successfully!');
    } catch (e) {
      console.error("Error adding document: ", e);
      showCustomModal(`Error adding document: ${e.message}`);
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

    try {
      const currentAppId = typeof __app_id !== 'undefined' ? __app_id : localAppId; // Use currentAppId for Firestore path
      // CHANGE: Delete from public collection
      await deleteDoc(doc(db, `artifacts/${currentAppId}/public/data/files`, fileId));
      showCustomModal('Document entry deleted successfully!');
    } catch (e) {
      console.error("Error deleting document: ", e);
      showCustomModal(`Error deleting document: ${e.message}`);
    }
  };

  // Function to handle viewing a document for investors
  const handleViewDocument = (fileUrl, fileName) => {
    setDocumentToViewUrl(fileUrl);
    setDocumentToViewName(fileName);
    setShowDocumentViewer(true);
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
      {/* Custom Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-sm w-full text-center">
            <p className="text-lg mb-4 whitespace-pre-wrap">{modalMessage}</p> {/* Added whitespace-pre-wrap */}
            <button
              onClick={() => setShowModal(false)}
              className="px-6 py-2 bg-[#1D68E5] text-white rounded-md hover:bg-blue-700 transition duration-300 shadow-md"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* Document Viewer Modal */}
      {showDocumentViewer && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl h-full max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-4 border-b border-gray-200">
              <h3 className="text-xl font-semibold text-gray-800 truncate">{documentToViewName}</h3>
              <button
                onClick={() => setShowDocumentViewer(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
              >
                &times;
              </button>
            </div>
            <div className="flex-grow p-4">
              {/* Google Docs Viewer for various document types */}
              <iframe
                src={`https://docs.google.com/viewer?url=${encodeURIComponent(documentToViewUrl)}&embedded=true`}
                className="w-full h-full border-0 rounded-md"
                allowFullScreen
                title="Document Viewer"
              >
                <p className="text-gray-600 text-center p-4">Your browser does not support iframes, or the document could not be loaded. Please try opening the document directly.</p>
              </iframe>
            </div>
            <div className="p-4 border-t border-gray-200 text-center text-gray-600 text-sm">
              Note: Print and download options are controlled by the external document host and your browser, not by this application.
            </div>
          </div>
        </div>
      )}

      {/* AI Insight Modal */}
      {showInsightModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-4 border-b border-gray-200">
              <h3 className="text-xl font-semibold text-gray-800">AI Document Insight</h3>
              <button
                onClick={() => setShowInsightModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
              >
                &times;
              </button>
            </div>
            <div className="flex-grow p-4 overflow-y-auto">
              {isGeneratingInsight ? (
                <p className="text-gray-600 text-center">Generating insights...</p>
              ) : llmInsight ? (
                <p className="text-gray-800 whitespace-pre-wrap">{llmInsight}</p>
              ) : (
                <p className="text-gray-600 text-center">No insight generated or an error occurred.</p>
              )}
            </div>
            <div className="p-4 border-t border-gray-200 text-center">
              <button
                onClick={() => setShowInsightModal(false)}
                className="px-6 py-2 bg-[#1D68E5] text-white rounded-md hover:bg-blue-700 transition duration-300 shadow-md"
              >
                Close
              </button>
            </div>
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

        {/* Add New File Section (Admin only) */}
        {userRole === 'admin' && (
          <div className="mb-8 p-6 bg-[#EBF4FA] rounded-lg shadow-inner"> {/* Light blue background */}
            <h2 className="text-2xl font-semibold text-[#00193A] mb-4">Add New Document Link</h2>
            {/* NEW: Drag and Drop Zone */}
            <div
              ref={dropZoneRef} // Attach ref to the drop zone
              className={`border-2 border-dashed rounded-lg p-6 text-center mb-4 transition-all duration-300
                          ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:border-blue-400'}`}
            >
              <p className="text-gray-600 mb-2">Drag & Drop a file here to auto-fill its name</p>
              <p className="text-sm text-gray-500">
                (You can also select a file below)
              </p>
              <input
                type="file"
                className="hidden"
                id="file-upload"
                onChange={handleFileChange}
                disabled={isUploading}
              />
              <label
                htmlFor="file-upload"
                className="mt-3 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-[#1D68E5] hover:bg-[#00193A] cursor-pointer transition duration-300"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                </svg>
                Select File
              </label>
            </div>

            {selectedFile && (
              <div className="mb-4 text-center">
                <p className="text-gray-700 text-sm mb-2">Selected: <span className="font-semibold">{selectedFile.name}</span></p>
                {isUploading && (
                  <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                    <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${uploadProgress}%` }}></div>
                  </div>
                )}
                <button
                  onClick={handleFileUpload}
                  disabled={isUploading}
                  className="mt-3 w-full bg-green-600 text-white py-2 rounded-lg font-semibold text-sm hover:bg-green-700 transition duration-300 shadow-md transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isUploading ? `Uploading (${Math.round(uploadProgress)}%)` : 'Upload File to Storage'}
                </button>
              </div>
            )}

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
                placeholder="External Document URL (or auto-filled after upload)"
                value={fileUrl}
                onChange={(e) => setFileUrl(e.target.value)}
                className="p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#1D68E5] focus:border-[#1D68E5] transition duration-200 w-full"
                disabled={isUploading} // Disable if uploading
              />
            </div>
            <button
              onClick={handleAddFile}
              disabled={isUploading || !fileUrl.trim() || !fileName.trim()} // Disable if uploading or missing info
              className="mt-6 w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold text-lg hover:bg-indigo-700 transition duration-300 shadow-lg transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
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
                    {userRole === 'admin' ? ( // Admin sees Download and Delete
                      <>
                        <button
                          onClick={() => generateDocumentInsight(file.name)}
                          disabled={isGeneratingInsight}
                          className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition duration-300 shadow-md flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isGeneratingInsight ? 'Generating...' : '✨ Get AI Insight ✨'}
                        </button>
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
                    ) : ( // Investor sees only View Document
                      <button
                        onClick={() => handleViewDocument(file.url, file.name)}
                        className="px-4 py-2 bg-[#1D68E5] text-white rounded-md hover:bg-[#00193A] transition duration-300 shadow-md flex items-center"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                          <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                        </svg>
                        View Document
                      </button>
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
