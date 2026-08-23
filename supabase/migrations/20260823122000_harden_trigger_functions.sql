-- ════════════════════════════════════════════════════════════════════
-- ΑΠΕ 4412 — θωράκιση των trigger functions
--
-- Οι handle_new_user() και bump_revision() είναι ΑΠΟΚΛΕΙΣΤΙΚΑ trigger
-- functions. Επειδή όμως ζουν στο σχήμα public, το PostgREST τις εκθέτει και
-- ως /rest/v1/rpc/<όνομα>, και επειδή είναι SECURITY DEFINER θα έτρεχαν με
-- δικαιώματα του ιδιοκτήτη. Ο security advisor του Supabase το επισημαίνει.
--
-- Τα triggers τις καλούν ανεξάρτητα από τα δικαιώματα EXECUTE, οπότε η
-- ανάκληση δεν επηρεάζει τη λειτουργία — κλείνει μόνο τον δρόμο της
-- απευθείας κλήσης από το API.
-- ════════════════════════════════════════════════════════════════════

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.bump_revision()   from public, anon, authenticated;
