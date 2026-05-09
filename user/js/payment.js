const PHONEPE_CONFIG = {
    // Credentials stored securely in Edge Function env vars — not here
    edgeFunctionUrl: 'https://hkdenuzxxrcvcgtbqgxq.supabase.co/functions/v1/create-payment',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrZGVudXp4eHJjdmNndGJxZ3hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3NTM5MjIsImV4cCI6MjA4NzMyOTkyMn0.2GgEChu1H-1vyKorxjDm_p4VHP7YOuSpFMo_wF8f6vY'
};

const Payment = {
    async createOrder(profile, cartItems, totalAmount) {
        const user = await Auth.getUser();
        if (!user) throw new Error('User not logged in');

        const orderData = {
            user_id:          user.id,
            customer_name:    profile.name,
            customer_phone:   profile.phone,
            shipping_address: profile.address || '',
            city:             profile.city    || '',
            pincode:          profile.pincode || '',
            items:            cartItems,
            total_amount:     totalAmount,
            payment_status:   'pending'
        };

        const { data, error } = await sb.from('orders').insert(orderData).select().single();
        if (error) throw error;
        return data;
    },

    async initiatePhonePePayment(order) {
        const main = document.getElementById('mainContent');

        // Show loading state
        main.innerHTML = `
            <div style="text-align:center;padding:100px 20px">
                <div class="spinner" style="width:50px;height:50px;border:3px solid rgba(212,175,55,.2);border-top-color:#D4AF37;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 24px"></div>
                <h2 class="cinzel" style="font-size:22px;color:#3B0764">Preparing Payment...</h2>
                <p style="color:#9CA3AF;margin-top:10px;font-size:14px">Connecting to PhonePe securely.</p>
            </div>
        `;

        try {
            // Call the Supabase Edge Function (server-side signing)
            const res = await fetch(PHONEPE_CONFIG.edgeFunctionUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${PHONEPE_CONFIG.anonKey}`
                },
                body: JSON.stringify({
                    orderId:       order.id,
                    amount:        order.total_amount,
                    customerPhone: order.customer_phone,
                    customerName:  order.customer_name,
                    siteUrl:       window.location.origin
                })
            });

            const result = await res.json();
            console.log("Edge Function Response:", result);

            if (result.success && result.redirectUrl) {
                // Redirect user to real PhonePe payment page
                window.location.href = result.redirectUrl;
            } else {
                console.error("PhonePe Error Result:", result);
                throw new Error(result.message || result.error || 'PhonePe did not return a payment URL. Check console for details.');
            }
        } catch(err) {
            main.innerHTML = `
                <div style="text-align:center;padding:100px 20px">
                    <div style="font-size:60px;margin-bottom:20px">⚠️</div>
                    <h2 class="cinzel" style="font-size:22px;color:#DC2626">Payment Setup Failed</h2>
                    <p style="color:#9CA3AF;margin:16px 0">${err.message}</p>
                    <button class="btn-gold" style="padding:14px 32px" onclick="showPage('cart')">Back to Cart</button>
                </div>
            `;
        }
    }
};
