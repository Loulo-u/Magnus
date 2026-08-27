// ============================================================
// CONFIGURATION FIREBASE
// ============================================================
// Remplacez les valeurs ci-dessous par celles de VOTRE projet Firebase.
// Vous les trouverez dans : Console Firebase > Paramètres du projet
// > Vos applications > Application Web > "Configuration du SDK".
//
// Ce fichier n'est PAS un secret à proprement parler (ces valeurs
// apparaissent de toute façon dans le code envoyé au navigateur),
// mais la vraie sécurité de vos données doit être assurée par les
// règles Firestore / Storage (voir README.md).
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyCWnEmWExyVTtk0StGTdiX54jDOtnxVa64",
  authDomain: "magnus-89dc6.firebaseapp.com",
  projectId: "magnus-89dc6",
  messagingSenderId: "366902298580",
  appId: "1:366902298580:web:864b29b678aca84e5fb841"
};

// Note : pas de Firebase Storage ici (nécessite le plan payant "Blaze").
// Les images de produits sont stockées directement dans Firestore,
// compressées en petites images (voir js/app.js).

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
