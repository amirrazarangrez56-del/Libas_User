/**
 * Libas Collection - Shared Checkout & Modal Logic
 */

const Checkout = {
    // Inject CSS for the modal
    injectStyles() {
        if (document.getElementById('checkout-styles')) return;
        const style = document.createElement('style');
        style.id = 'checkout-styles';
        style.innerHTML = `
            #checkoutModal {
                display: none;
                position: fixed;
                inset: 0;
                z-index: 10000;
                background: rgba(24, 6, 38, 0.85);
                backdrop-filter: blur(8px);
                align-items: center;
                justify-content: center;
                padding: 20px;
                animation: fadeUp 0.3s ease;
            }
            #checkoutModal.open { display: flex; }
            .checkout-box {
                background: #fff;
                border-radius: 20px;
                width: 100%;
                max-width: 520px;
                max-height: 90vh;
                display: flex;
                flex-direction: column;
                border: 1px solid rgba(212, 175, 55, 0.3);
                box-shadow: 0 24px 80px rgba(0, 0, 0, 0.4);
                overflow: hidden;
            }
            .checkout-header {
                padding: 20px 24px;
                background: linear-gradient(135deg, #180626, #3B0764);
                color: #E8CC6A;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .checkout-body { padding: 24px; overflow-y: auto; }
            .checkout-footer {
                padding: 20px 24px;
                border-top: 1px solid rgba(0, 0, 0, 0.05);
                background: #fcfaf5;
            }
        `;
        document.head.appendChild(style);
    },

    // Inject HTML for the modal
    injectHTML() {
        if (document.getElementById('checkoutModal')) return;
        const div = document.createElement('div');
        div.id = 'checkoutModal';
        div.innerHTML = `
            <div class="checkout-box">
                <div class="checkout-header">
                    <h3 class="cinzel" style="font-size:16px;font-weight:700;letter-spacing:1px">Review & Confirm Order</h3>
                    <button onclick="Checkout.close()" style="background:none;border:none;color:#f87171;font-size:24px;cursor:pointer">&times;</button>
                </div>
                <div class="checkout-body" id="checkoutModalBody"></div>
                <div class="checkout-footer">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                        <span class="cinzel" style="font-weight:700;color:#9CA3AF;font-size:12px">TOTAL AMOUNT</span>
                        <span class="cinzel" id="modalTotalAmount" style="font-weight:700;font-size:24px;color:#3B0764">₹0</span>
                    </div>
                    <button onclick="Checkout.confirm()" class="btn-gold" style="width:100%;padding:16px;border-radius:10px;font-size:14px">CONFIRM & PAY NOW →</button>
                </div>
            </div>
        `;
        document.body.appendChild(div);
    },

    async proceed() {
        this.injectStyles();
        this.injectHTML();
        
        const user = await Auth.getUser();
        if (!user) {
            const currentUrl = new URL(window.location.href);
            currentUrl.searchParams.set('checkout', '1');
            Auth.setReturnUrl(currentUrl.toString());
            window.location.href = 'signin.html';
            return;
        }
        this.openModal();
    },

    async openModal() {
        const profile = await Auth.getProfile();
        // Assume 'cart' global exists
        const cartItems = JSON.parse(localStorage.getItem('libas_cart') || '[]');
        const total = cartItems.reduce((s,i) => s + Number(i.price)*i.qty, 0);
        
        if (cartItems.length === 0) {
            alert('Your cart is empty.');
            return;
        }

        document.getElementById('modalTotalAmount').textContent = '₹' + total.toFixed(0);
        
        const body = document.getElementById('checkoutModalBody');
        body.innerHTML = `
            <div style="margin-bottom:24px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                    <p class="cinzel" style="font-size:10px;color:#C9A020;letter-spacing:2px">DELIVERY DETAILS</p>
                    <button onclick="Checkout.toggleEdit()" class="btn-outline" style="font-size:10px;padding:4px 10px;border-radius:4px" id="checkoutEditBtn">✏️ Edit</button>
                </div>
                
                <div id="checkoutDetailsDisplay" style="background:rgba(59,7,100,0.03);border:1px solid rgba(212,175,55,0.15);border-radius:12px;padding:16px">
                    <p style="font-weight:700;color:#3B0764;font-size:16px;margin-bottom:4px" id="dispName">${profile?.name || '—'}</p>
                    <p style="font-size:13px;color:#6B7280;line-height:1.5" id="dispAddr">${profile?.address || '—'}${profile?.city ? ', ' + profile.city : ''}${profile?.pincode ? ' - ' + profile.pincode : ''}</p>
                    <p style="font-size:13px;color:#3B0764;margin-top:6px;font-weight:600" id="dispPhone">📞 ${profile?.phone || '—'}</p>
                </div>

                <div id="checkoutEditForm" style="display:none;margin-top:12px;padding-top:12px;border-top:1px dashed rgba(212,175,55,0.3)">
                    <div style="display:grid;gap:12px">
                        <input id="sh_name" class="input-field" type="text" placeholder="Full Name" value="${profile?.name || ''}">
                        <input id="sh_phone" class="input-field" type="tel" placeholder="Phone Number" value="${profile?.phone || ''}" maxlength="10">
                        <textarea id="sh_address" class="input-field" placeholder="Full Address" rows="2">${profile?.address || ''}</textarea>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                            <input id="sh_city" class="input-field" type="text" placeholder="City" value="${profile?.city || ''}">
                            <input id="sh_pincode" class="input-field" type="text" placeholder="Pincode" value="${profile?.pincode || ''}" maxlength="6">
                        </div>
                        <button onclick="Checkout.saveEdits()" class="btn-purple" style="padding:10px;border-radius:6px;font-size:11px;width:100%">Update Details</button>
                    </div>
                </div>
            </div>

            <div style="margin-top:24px">
                <p class="cinzel" style="font-size:10px;color:#C9A020;letter-spacing:2px;margin-bottom:12px">ORDER SUMMARY (${cartItems.length} items)</p>
                <div style="max-height:200px;overflow-y:auto;padding-right:8px">
                    ${cartItems.map(it => `
                        <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(0,0,0,0.05)">
                            <div style="flex:1;min-width:0">
                                <p style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${it.name}</p>
                                <p style="font-size:11px;color:#9CA3AF">${it.selectedSize || ''} × ${it.qty}</p>
                            </div>
                            <span class="cinzel" style="font-weight:700;font-size:13px;color:#3B0764">₹${(Number(it.price)*it.qty).toFixed(0)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        document.getElementById('checkoutModal').classList.add('open');
        
        // If profile incomplete, auto-open edit form
        if (!profile?.name || !profile?.address) this.toggleEdit();
    },

    close() {
        document.getElementById('checkoutModal').classList.remove('open');
    },

    toggleEdit() {
        const form = document.getElementById('checkoutEditForm');
        const disp = document.getElementById('checkoutDetailsDisplay');
        const btn  = document.getElementById('checkoutEditBtn');
        if (!form) return;
        const isHidden = form.style.display === 'none';
        form.style.display = isHidden ? 'block' : 'none';
        disp.style.opacity = isHidden ? '0.4' : '1';
        btn.textContent = isHidden ? '✕ Cancel' : '✏️ Edit';
    },

    saveEdits() {
        const name = document.getElementById('sh_name').value.trim();
        const addr = document.getElementById('sh_address').value.trim();
        const phone = document.getElementById('sh_phone').value.trim();
        const city = document.getElementById('sh_city').value.trim();
        const pin = document.getElementById('sh_pincode').value.trim();

        if (!name || !addr || !phone) { alert('Name, Address and Phone are required.'); return; }

        document.getElementById('dispName').textContent = name;
        document.getElementById('dispAddr').textContent = `${addr}${city ? ', ' + city : ''}${pin ? ' - ' + pin : ''}`;
        document.getElementById('dispPhone').textContent = '📞 ' + phone;
        
        this.toggleEdit();
    },

    async confirm() {
        const profile = await Auth.getProfile();
        
        // Use either edited values or profile values
        const name    = document.getElementById('sh_name')?.value.trim()    || profile?.name;
        const phone   = document.getElementById('sh_phone')?.value.trim()   || profile?.phone;
        const addr    = document.getElementById('sh_address')?.value.trim() || profile?.address;
        const city    = document.getElementById('sh_city')?.value.trim()    || profile?.city || '';
        const pincode = document.getElementById('sh_pincode')?.value.trim() || profile?.pincode || '';

        if (!name || !phone || !addr) { 
            alert('Please ensure Name, Phone and Address are provided. Click "Edit" if needed.'); 
            if (document.getElementById('checkoutEditForm').style.display === 'none') this.toggleEdit();
            return; 
        }

        const cartItems = JSON.parse(localStorage.getItem('libas_cart') || '[]');
        const total = cartItems.reduce((s,i) => s + Number(i.price)*i.qty, 0);

        try {
            const orderProfile = { name, phone, address: addr, city, pincode, id: profile?.id };
            const order = await Payment.createOrder(orderProfile, cartItems, total);
            await Payment.initiatePhonePePayment(order);
            
            // Clear cart
            localStorage.setItem('libas_cart', '[]');
            if (typeof window.cart !== 'undefined') window.cart = [];
            if (typeof updateCartBadge === 'function') updateCartBadge();
            this.close();
        } catch(e) {
            alert('Error initiating order: ' + e.message);
        }
    },

    // Check for checkout intent in URL
    checkIntent() {
        const params = new URLSearchParams(window.location.search);
        if (params.get('checkout') === '1') {
            // Clean URL
            const url = new URL(window.location.href);
            url.searchParams.delete('checkout');
            window.history.replaceState({}, '', url.toString());
            
            this.proceed();
        }
    }
};

// Auto-init intent check on load
document.addEventListener('DOMContentLoaded', () => Checkout.checkIntent());
