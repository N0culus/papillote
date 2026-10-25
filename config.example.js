// Copie ce fichier en "config.js" (cp config.example.js config.js) puis remplace les deux valeurs.
// Tu les trouves dans Supabase > Project Settings > API.
//
// Ces deux valeurs sont PUBLIQUES par conception (la clé "anon" est faite pour être dans un
// navigateur) : la sécurité repose sur la RLS et les fonctions SQL, pas sur le secret de cette clé.
// NE METS JAMAIS ici la clé "service_role".

export const SUPABASE_URL = 'https://VOTRE-PROJET.supabase.co';
export const SUPABASE_ANON_KEY = 'VOTRE_CLE_ANON_PUBLIQUE';
