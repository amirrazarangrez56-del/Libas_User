const SUPABASE_URL = 'https://hkdenuzxxrcvcgtbqgxq.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrZGVudXp4eHJjdmNndGJxZ3hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3NTM5MjIsImV4cCI6MjA4NzMyOTkyMn0.2GgEChu1H-1vyKorxjDm_p4VHP7YOuSpFMo_wF8f6vY';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── ITEM 8: Auto-derive password from phone (user never sees this) ──
function _pw(phone) {
    return `LB@${phone}#2024!`;
}

const Auth = {
    async signUp(phone, profileData) {
        const email = `${phone}@libas.app`;
        const password = _pw(phone);
        const { data: authData, error: authError } = await sb.auth.signUp({ email, password });
        if (authError) throw authError;
        if (authData.user) {
            const { error: profileError } = await sb.from('profiles').insert({
                id: authData.user.id,
                phone: phone,
                ...profileData
            });
            if (profileError) throw profileError;
        }
        return authData;
    },

    async signIn(phone) {
        const email = `${phone}@libas.app`;
        const password = _pw(phone);
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data;
    },

    async signOut() {
        const { error } = await sb.auth.signOut();
        if (error) throw error;
        localStorage.removeItem('libas_profile');
        window.location.href = 'index.html';
    },

    async getUser() {
        const { data: { session } } = await sb.auth.getSession();
        return session ? session.user : null;
    },

    async getProfile() {
        const user = await this.getUser();
        if (!user) return null;

        // Cache for speed
        const cached = localStorage.getItem('libas_profile');
        if (cached) {
            try {
                const profile = JSON.parse(cached);
                if (profile.id === user.id) return profile;
            } catch (e) { }
        }

        const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
        if (error) return null;

        localStorage.setItem('libas_profile', JSON.stringify(data));
        return data;
    },

    onAuthStateChange(callback) {
        return sb.auth.onAuthStateChange(callback);
    },

    setReturnUrl(url) {
        sessionStorage.setItem('libas_return_url', url);
    },

    consumeReturnUrl() {
        const url = sessionStorage.getItem('libas_return_url');
        sessionStorage.removeItem('libas_return_url');
        return url;
    }
};

// ── LOGIN button UI ──
async function updateProfileUI() {
    const user = await Auth.getUser();
    const profileBtn = document.getElementById('profileBtn');
    const mobileMenu = document.getElementById('mobileMenu');
    
    // Update Header Button
    if (profileBtn) {
        if (user) {
            profileBtn.innerHTML = `<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="#E8CC6A" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>`;
            profileBtn.onclick = () => window.location.href = 'profile.html';
            profileBtn.title = 'My Profile';
        } else {
            profileBtn.innerHTML = `<span style="font-family:'Cinzel',serif;font-size:11px;font-weight:700;color:#E8CC6A;letter-spacing:1px;border:1px solid rgba(212,175,55,.5);padding:5px 12px;border-radius:6px;white-space:nowrap;background:rgba(212,175,55,0.1)">LOGIN</span>`;
            profileBtn.onclick = () => {
                Auth.setReturnUrl(window.location.href);
                window.location.href = 'signin.html';
            };
            profileBtn.title = 'Sign In';
        }
    }

    // Update Mobile Menu
    if (mobileMenu) {
        // Remove existing auth links if any
        const existing = mobileMenu.querySelector('.mobile-auth-link');
        if (existing) existing.remove();

        const authLink = document.createElement('button');
        authLink.className = 'nav-link mobile-auth-link';
        authLink.style.display = 'block';
        authLink.style.marginTop = '14px';
        authLink.style.fontSize = '14px';
        authLink.style.width = '100%';
        authLink.style.textAlign = 'left';
        
        if (user) {
            authLink.textContent = 'My Profile';
            authLink.onclick = () => { window.location.href = 'profile.html'; toggleMobileMenu(); };
        } else {
            authLink.textContent = 'Login / Register';
            authLink.onclick = () => { 
                Auth.setReturnUrl(window.location.href);
                window.location.href = 'signin.html';
                toggleMobileMenu();
            };
        }
        mobileMenu.appendChild(authLink);
    }
}

document.addEventListener('DOMContentLoaded', updateProfileUI);
