```javascript
// ============================================================
// PAYMENT PAGE LOGIC — MASIKA BENEVOLENT
// ============================================================
// FastAPI payment contract:
//
//   POST /api/public/payment/stk-push
//   GET  /api/public/payment/status/{checkout_request_id}
//
// Individual registration session:
//
//   newMemberId
//   newMemberNumber
//   newMemberName
//   newMemberPhone
//   registrationAmount
//   registrationPlan
//   registrationPlanName
//   registrationType
//   isChamaRegistration
//
// Chama session:
//
//   newChamaGroupId
//   newChamaGroupName
//   newChamaMemberCount
//   newChamaPhone
//
// IMPORTANT:
// - No Daraja credentials are stored here.
// - M-Pesa STK Push is handled by FastAPI.
// - Frontend only communicates with the public payment API.
// - The current FastAPI payment endpoint accepts member_id.
// ============================================================

(function () {

    'use strict';

    // ============================================================
    // CONFIGURATION
    // ============================================================

    const API_BASE_URL =
        'https://masika-c921.onrender.com';

    const CONFIG = {
        API: API_BASE_URL,

        REQUEST_TIMEOUT: 60000,

        POLL_INTERVAL: 3000,

        MAX_POLL_ATTEMPTS: 60
    };


    // ============================================================
    // BUILD MARKER
    // ============================================================
    // This makes it immediately obvious in the browser console
    // whether the new payment.js has actually loaded.
    // ============================================================

    console.log(
        'payment.js: MASIKA PAYMENT SCRIPT LOADED — FIXED BUILD 2026-09-06'
    );


    // ============================================================
    // DOM HELPER
    // ============================================================

    const $ = id =>
        document.getElementById(id);


    // ============================================================
    // DOM ELEMENTS
    // ============================================================

    const el = {
        alertBox: null,

        paymentForm: null,

        paymentCard: null,

        processingCard: null,

        successCard: null,

        memberName: null,

        memberNumber: null,

        memberPlan: null,

        registrationType: null,

        paymentAmount: null,

        mpesaPhone: null,

        phoneError: null,

        payNowBtn: null,

        backBtn: null,

        cancelPaymentBtn: null,

        processingTitle: null,

        processingMessage: null,

        successMemberNumber: null,

        successTransactionId: null,

        successAmount: null,

        viewMemberBtn: null,

        year: null,

        step1Circle: null,

        step2Circle: null,

        step3Circle: null,

        step4Circle: null,

        step1Label: null,

        step2Label: null,

        step3Label: null,

        step4Label: null
    };


    // ============================================================
    // STATE
    // ============================================================

    const state = {

        initialized: false,

        memberId: null,

        groupId: null,

        isChama: false,

        amount: 0,

        memberData: null,

        checkoutRequestId: null,

        paymentId: null,

        isProcessing: false,

        pollAttempts: 0,

        paymentCompleted: false
    };


    // ============================================================
    // LOAD DOM REFERENCES
    // ============================================================

    function loadDomReferences() {

        el.alertBox =
            $('alertBox');

        el.paymentForm =
            $('paymentForm');

        el.paymentCard =
            $('paymentCard');

        el.processingCard =
            $('processingCard');

        el.successCard =
            $('successCard');

        el.memberName =
            $('memberName');

        el.memberNumber =
            $('memberNumber');

        el.memberPlan =
            $('memberPlan');

        el.registrationType =
            $('registrationType');

        el.paymentAmount =
            $('paymentAmount');

        el.mpesaPhone =
            $('mpesaPhone');

        el.phoneError =
            $('phoneError');

        el.payNowBtn =
            $('payNowBtn');

        el.backBtn =
            $('backBtn');

        el.cancelPaymentBtn =
            $('cancelPaymentBtn');

        el.processingTitle =
            $('processingTitle');

        el.processingMessage =
            $('processingMessage');

        el.successMemberNumber =
            $('successMemberNumber');

        el.successTransactionId =
            $('successTransactionId');

        el.successAmount =
            $('successAmount');

        el.viewMemberBtn =
            $('viewMemberBtn');

        el.year =
            $('year');

        el.step1Circle =
            $('step1Circle');

        el.step2Circle =
            $('step2Circle');

        el.step3Circle =
            $('step3Circle');

        el.step4Circle =
            $('step4Circle');

        el.step1Label =
            $('step1Label');

        el.step2Label =
            $('step2Label');

        el.step3Label =
            $('step3Label');

        el.step4Label =
            $('step4Label');


        Object.entries(el).forEach(
            ([key, node]) => {

                if (!node) {

                    console.warn(
                        `payment.js: element #${key} was not found.`
                    );
                }
            }
        );
    }


    // ============================================================
    // ALERTS
    // ============================================================

    function showAlert(
        message,
        type = 'info'
    ) {

        if (!el.alertBox) {
            return;
        }

        el.alertBox.textContent =
            message;

        el.alertBox.className =
            `alert ${type} show`;
    }


    function clearAlert() {

        if (!el.alertBox) {
            return;
        }

        el.alertBox.textContent =
            '';

        el.alertBox.className =
            'alert';
    }


    // ============================================================
    // PHONE NORMALIZATION
    // ============================================================

    function normalizePhone(phone) {

        let value =
            String(phone || '')
                .trim()
                .replace(/\s+/g, '')
                .replace(/-/g, '');


        if (!value) {
            return '';
        }


        // +254712345678
        // -> 254712345678

        if (value.startsWith('+254')) {

            value =
                value.substring(1);
        }


        // 0712345678
        // -> 254712345678

        if (
            /^0[71]\d{8}$/.test(value)
        ) {

            value =
                '254' +
                value.substring(1);
        }


        // 712345678
        // -> 254712345678

        if (
            /^[71]\d{8}$/.test(value)
        ) {

            value =
                '254' +
                value;
        }


        return value;
    }


    function validatePhone(phone) {

        const normalized =
            normalizePhone(phone);

        return /^254[17]\d{8}$/.test(
            normalized
        );
    }


    // ============================================================
    // MONEY
    // ============================================================

    function formatMoney(amount) {

        const num =
            Number(amount || 0);


        return (
            'KES ' +
            num.toLocaleString(
                'en-KE',
                {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0
                }
            )
        );
    }


    // ============================================================
    // GENERAL HELPERS
    // ============================================================

    function sleep(ms) {

        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    ms
                )
        );
    }


    function firstDefined(...values) {

        for (
            const value of values
        ) {

            if (
                value !== undefined &&
                value !== null &&
                value !== ''
            ) {

                return value;
            }
        }

        return undefined;
    }


    function getSession(key) {

        try {

            return sessionStorage.getItem(key);

        } catch (error) {

            console.error(
                'payment.js: unable to read sessionStorage:',
                error
            );

            return null;
        }
    }


    function setSession(key, value) {

        try {

            sessionStorage.setItem(
                key,
                String(value ?? '')
            );

        } catch (error) {

            console.error(
                'payment.js: unable to write sessionStorage:',
                error
            );

            throw error;
        }
    }


    // ============================================================
    // PAYMENT RESPONSE HELPERS
    // ============================================================

    function getPaymentData(result) {

        if (
            result &&
            typeof result.data === 'object' &&
            result.data !== null
        ) {

            return result.data;
        }

        return result || {};
    }


    function extractCheckoutRequestId(result) {

        const data =
            getPaymentData(result);


        return firstDefined(

            data.checkout_request_id,

            data.CheckoutRequestID,

            result?.checkout_request_id,

            result?.CheckoutRequestID
        );
    }


    function extractPaymentStatus(result) {

        const data =
            getPaymentData(result);


        const raw =
            firstDefined(

                data.status,

                data.payment_status,

                data.paymentStatus,

                data.state,

                result?.status,

                result?.payment_status,

                result?.paymentStatus,

                result?.state
            );


        return String(
            raw || ''
        )
            .trim()
            .toLowerCase();
    }


    function extractPaymentMessage(result) {

        const data =
            getPaymentData(result);


        return firstDefined(

            data.message,

            data.result_desc,

            data.result_description,

            result?.message,

            result?.result_desc,

            result?.result_description,

            'Payment status unavailable.'
        );
    }


    function extractReceipt(result) {

        const data =
            getPaymentData(result);


        return firstDefined(

            data.receipt,

            data.mpesa_receipt_number,

            data.receipt_number,

            data.mpesaReceiptNumber,

            result?.receipt,

            result?.mpesa_receipt_number,

            result?.receipt_number,

            result?.mpesaReceiptNumber
        );
    }


    function extractAmount(result) {

        const data =
            getPaymentData(result);


        const amount =
            firstDefined(

                data.amount,

                result?.amount,

                state.amount
            );


        const numericAmount =
            Number(amount);


        return Number.isFinite(
            numericAmount
        )
            ? numericAmount
            : state.amount;
    }


    // ============================================================
    // PAYMENT STATUS
    // ============================================================

    const SUCCESS_STATUSES =
        new Set([
            'completed',
            'complete',
            'success',
            'successful',
            'paid',
            'confirmed'
        ]);


    const FAILURE_STATUSES =
        new Set([
            'failed',
            'failure',
            'cancelled',
            'canceled',
            'declined',
            'timeout',
            'expired',
            'error'
        ]);


    // ============================================================
    // PAYMENT STEPS
    // ============================================================

    function updateStep(
        step,
        status
    ) {

        const circles = {
            1: el.step1Circle,
            2: el.step2Circle,
            3: el.step3Circle,
            4: el.step4Circle
        };


        const labels = {
            1: el.step1Label,
            2: el.step2Label,
            3: el.step3Label,
            4: el.step4Label
        };


        const circle =
            circles[step];

        const label =
            labels[step];


        if (
            !circle ||
            !label
        ) {

            return;
        }


        circle.className =
            'circle';

        label.className =
            'label';


        if (
            status === 'active'
        ) {

            circle.classList.add(
                'active'
            );

            label.classList.add(
                'active'
            );

            circle.textContent =
                String(step);
        }


        else if (
            status === 'completed'
        ) {

            circle.classList.add(
                'completed'
            );

            circle.textContent =
                '✓';
        }


        else if (
            status === 'error'
        ) {

            circle.classList.add(
                'error'
            );

            circle.textContent =
                '✗';
        }

        else {

            circle.textContent =
                String(step);
        }
    }


    function resetSteps() {

        for (
            let i = 1;
            i <= 4;
            i++
        ) {

            const circle =
                ({
                    1: el.step1Circle,
                    2: el.step2Circle,
                    3: el.step3Circle,
                    4: el.step4Circle
                })[i];


            const label =
                ({
                    1: el.step1Label,
                    2: el.step2Label,
                    3: el.step3Label,
                    4: el.step4Label
                })[i];


            if (circle) {

                circle.className =
                    'circle';

                circle.textContent =
                    String(i);
            }


            if (label) {

                label.className =
                    'label';
            }
        }


        updateStep(
            1,
            'completed'
        );

        updateStep(
            2,
            'active'
        );
    }


    // ============================================================
    // API REQUEST
    // ============================================================

    async function apiRequest(
        endpoint,
        options = {}
    ) {

        const controller =
            new AbortController();


        const timer =
            setTimeout(
                () => controller.abort(),
                CONFIG.REQUEST_TIMEOUT
            );


        try {

            console.log(
                'payment.js: API request:',
                endpoint,
                options.method || 'GET'
            );


            const response =
                await fetch(

                    `${CONFIG.API}${endpoint}`,

                    {
                        ...options,

                        headers: {
                            'Content-Type':
                                'application/json',

                            'Accept':
                                'application/json',

                            ...(options.headers || {})
                        },

                        signal:
                            controller.signal
                    }
                );


            const responseText =
                await response.text();


            let result =
                null;


            if (responseText) {

                try {

                    result =
                        JSON.parse(
                            responseText
                        );

                } catch {

                    result =
                        null;
                }
            }


            console.log(
                'payment.js: API response:',
                {
                    endpoint,
                    status:
                        response.status,
                    ok:
                        response.ok,
                    result
                }
            );


            if (
                !response.ok
            ) {

                let message =
                    result?.error ||
                    result?.message ||
                    result?.detail;


                // FastAPI validation errors

                if (
                    Array.isArray(
                        result?.detail
                    )
                ) {

                    message =
                        result.detail
                            .map(
                                item => {

                                    const location =
                                        Array.isArray(
                                            item.loc
                                        )
                                            ? item.loc
                                            : [];


                                    const field =
                                        location.length > 1
                                            ? location
                                                .slice(1)
                                                .join('.')
                                            : 'field';


                                    const readableField =
                                        field
                                            .replace(
                                                /_/g,
                                                ' '
                                            )
                                            .replace(
                                                /\b\w/g,
                                                char =>
                                                    char.toUpperCase()
                                            );


                                    return (
                                        `${readableField}: ${item.msg}`
                                    );
                                }
                            )
                            .join(
                                ' | '
                            );
                }


                if (
                    typeof message ===
                    'object' &&
                    message !== null
                ) {

                    message =
                        JSON.stringify(
                            message
                        );
                }


                throw new Error(

                    message ||

                    `Server returned HTTP ${response.status}.`
                );
            }


            return result;

        }

        catch (error) {

            if (
                error.name ===
                'AbortError'
            ) {

                throw new Error(
                    'The request took too long to respond. Please try again.'
                );
            }


            console.error(
                `payment.js: request to ${endpoint} failed:`,
                error
            );


            throw error;

        }

        finally {

            clearTimeout(
                timer
            );
        }
    }


    // ============================================================
    // LOAD PAYMENT DATA
    // ============================================================

    function loadPaymentData() {

        console.log(
            'payment.js: loading payment data...'
        );


        const params =
            new URLSearchParams(
                window.location.search
            );


        // --------------------------------------------------------
        // MEMBER ID
        // --------------------------------------------------------

        state.memberId =
            params.get('member_id') ||
            getSession('newMemberId');


        // --------------------------------------------------------
        // CHAMA ID
        // --------------------------------------------------------

        state.groupId =
            params.get('group_id') ||
            getSession('newChamaGroupId');


        // --------------------------------------------------------
        // DETERMINE REGISTRATION TYPE
        // --------------------------------------------------------

        const storedChamaFlag =
            String(
                getSession(
                    'isChamaRegistration'
                ) || ''
            ).toLowerCase();


        state.isChama =
            (
                storedChamaFlag === 'true' ||
                storedChamaFlag === '1' ||
                (
                    !!state.groupId &&
                    !state.memberId
                )
            );


        console.log(
            'payment.js: registration identity:',
            {
                memberId:
                    state.memberId,

                groupId:
                    state.groupId,

                isChama:
                    state.isChama
            }
        );


        // ========================================================
        // INDIVIDUAL REGISTRATION
        // ========================================================

        if (
            state.memberId
        ) {

            const memberNumber =
                getSession(
                    'newMemberNumber'
                ) || 'Pending';


            const memberName =
                getSession(
                    'newMemberName'
                ) || 'Member';


            const memberPhone =
                getSession(
                    'newMemberPhone'
                ) || '';


            const planCode =
                getSession(
                    'registrationPlan'
                ) || '';


            const planName =
                getSession(
                    'registrationPlanName'
                ) ||
                planCode ||
                '—';


            const registrationType =
                getSession(
                    'registrationType'
                ) ||
                'Individual';


            const storedAmount =
                Number(
                    getSession(
                        'registrationAmount'
                    ) || 0
                );


            state.amount =
                Number.isFinite(
                    storedAmount
                )
                    ? storedAmount
                    : 0;


            state.memberData = {

                id:
                    state.memberId,

                member_number:
                    memberNumber,

                full_name:
                    memberName,

                phone:
                    memberPhone,

                plan_code:
                    planCode,

                plan_name:
                    planName
            };


            // ----------------------------------------------------
            // DISPLAY MEMBER
            // ----------------------------------------------------

            if (el.memberName) {

                el.memberName.textContent =
                    memberName;
            }


            if (el.memberNumber) {

                el.memberNumber.textContent =
                    memberNumber;
            }


            if (el.registrationType) {

                el.registrationType.textContent =
                    registrationType;
            }


            if (el.memberPlan) {

                el.memberPlan.textContent =
                    planName;
            }


            if (
                el.mpesaPhone &&
                memberPhone &&
                !el.mpesaPhone.value
            ) {

                el.mpesaPhone.value =
                    memberPhone;
            }


            // ----------------------------------------------------
            // DISPLAY AMOUNT
            // ----------------------------------------------------

            if (el.paymentAmount) {

                el.paymentAmount.textContent =
                    formatMoney(
                        state.amount
                    );
            }


            console.log(
                'payment.js: individual payment data loaded:',
                {
                    memberId:
                        state.memberId,

                    memberNumber,

                    memberName,

                    memberPhone,

                    planCode,

                    planName,

                    registrationType,

                    amount:
                        state.amount
                }
            );
        }


        // ========================================================
        // CHAMA REGISTRATION
        // ========================================================

        else if (
            state.isChama &&
            state.groupId
        ) {

            const groupName =
                getSession(
                    'newChamaGroupName'
                ) ||
                'Chama Group';


            const groupPhone =
                getSession(
                    'newChamaPhone'
                ) ||
                '';


            const storedAmount =
                Number(
                    getSession(
                        'registrationAmount'
                    ) || 0
                );


            state.amount =
                Number.isFinite(
                    storedAmount
                )
                    ? storedAmount
                    : 0;


            state.memberData = {

                id:
                    state.groupId,

                group_name:
                    groupName,

                group_id:
                    state.groupId
            };


            if (el.memberName) {

                el.memberName.textContent =
                    groupName;
            }


            if (el.memberNumber) {

                el.memberNumber.textContent =
                    state.groupId;
            }


            if (el.registrationType) {

                el.registrationType.textContent =
                    'Chama / Group';
            }


            if (el.memberPlan) {

                el.memberPlan.textContent =
                    'Chama';
            }


            if (
                el.mpesaPhone &&
                groupPhone &&
                !el.mpesaPhone.value
            ) {

                el.mpesaPhone.value =
                    groupPhone;
            }


            if (el.paymentAmount) {

                el.paymentAmount.textContent =
                    formatMoney(
                        state.amount
                    );
            }


            console.log(
                'payment.js: Chama payment data loaded:',
                {
                    groupId:
                        state.groupId,

                    groupName,

                    amount:
                        state.amount
                }
            );
        }


        // ========================================================
        // NOTHING FOUND
        // ========================================================

        else {

            console.error(
                'payment.js: no member or Chama registration found.'
            );


            showAlert(
                'No registration was found. Please restart the registration process.',
                'error'
            );


            if (el.payNowBtn) {

                el.payNowBtn.disabled =
                    true;
            }


            return;
        }


        // ========================================================
        // VALIDATE AMOUNT
        // ========================================================

        if (
            state.amount <= 0
        ) {

            console.error(
                'payment.js: invalid registration amount:',
                state.amount
            );


            showAlert(
                'No valid registration payment amount was found. Please restart registration.',
                'warning'
            );


            if (el.payNowBtn) {

                el.payNowBtn.disabled =
                    true;
            }


            return;
        }


        // ========================================================
        // ENABLE PAYMENT
        // ========================================================

        if (el.payNowBtn) {

            el.payNowBtn.disabled =
                false;
        }


        clearAlert();


        validatePhoneInput();


        console.log(
            'payment.js: payment data loaded successfully:',
            {
                memberId:
                    state.memberId,

                memberNumber:
                    state.memberData?.member_number,

                amount:
                    state.amount,

                phone:
                    el.mpesaPhone?.value,

                plan:
                    state.memberData?.plan_name
            }
        );
    }


    // ============================================================
    // INITIATE PAYMENT
    // ============================================================

    async function initiatePayment() {

        console.log(
            'payment.js: initiatePayment() called.'
        );


        if (
            state.isProcessing
        ) {

            console.warn(
                'payment.js: payment already processing.'
            );

            return;
        }


        // ========================================================
        // CHAMA NOT SUPPORTED BY CURRENT BACKEND
        // ========================================================

        if (
            state.isChama
        ) {

            showAlert(
                'Chama registration payment is not yet enabled on the current payment API.',
                'warning'
            );


            console.warn(
                'payment.js: Chama payment blocked because current FastAPI StkPushRequest requires member_id.'
            );


            return;
        }


        // ========================================================
        // MEMBER VALIDATION
        // ========================================================

        if (
            !state.memberId
        ) {

            showAlert(
                'Member information is missing. Please restart registration.',
                'error'
            );

            return;
        }


        // ========================================================
        // PHONE
        // ========================================================

        if (
            !el.mpesaPhone
        ) {

            showAlert(
                'M-Pesa phone number field was not found.',
                'error'
            );

            return;
        }


        const phone =
            normalizePhone(
                el.mpesaPhone.value
            );


        console.log(
            'payment.js: normalized phone:',
            phone
        );


        if (
            !validatePhone(phone)
        ) {

            if (el.phoneError) {

                el.phoneError.classList.add(
                    'show'
                );
            }


            el.mpesaPhone.classList.add(
                'input-error'
            );


            showAlert(
                'Please enter a valid Kenyan M-Pesa phone number.',
                'warning'
            );


            return;
        }


        if (el.phoneError) {

            el.phoneError.classList.remove(
                'show'
            );
        }


        el.mpesaPhone.classList.remove(
            'input-error'
        );


        // ========================================================
        // AMOUNT
        // ========================================================

        if (
            !state.amount ||
            state.amount <= 0
        ) {

            showAlert(
                'Invalid registration payment amount. Please restart registration.',
                'error'
            );

            return;
        }


        // ========================================================
        // LOCK PAYMENT
        // ========================================================

        state.isProcessing =
            true;


        if (el.payNowBtn) {

            el.payNowBtn.disabled =
                true;

            el.payNowBtn.innerHTML =
                '<span class="spinner"></span> Processing...';
        }


        clearAlert();


        updateStep(
            2,
            'active'
        );


        // ========================================================
        // FASTAPI PAYLOAD
        // ========================================================
        //
        // IMPORTANT:
        // Current backend StkPushRequest accepts:
        //
        // member_id
        // phone
        // amount
        // transaction_desc
        //
        // Do NOT send group_id/payment_type here.
        // ========================================================

        const payload = {

            member_id:
                state.memberId,

            phone:
                phone,

            amount:
                state.amount,

            transaction_desc:
                'Membership Registration'
        };


        console.log(
            'payment.js: initiating STK payment:',
            payload
        );


        try {

            // ====================================================
            // SEND STK REQUEST
            // ====================================================

            const result =
                await apiRequest(
                    '/api/public/payment/stk-push',
                    {
                        method:
                            'POST',

                        body:
                            JSON.stringify(
                                payload
                            )
                    }
                );


            console.log(
                'payment.js: STK push response:',
                result
            );


            // ====================================================
            // BACKEND EXPLICIT FAILURE
            // ====================================================

            if (
                result?.success === false
            ) {

                throw new Error(

                    result?.message ||

                    result?.error ||

                    'Payment initiation failed.'
                );
            }


            // ====================================================
            // CHECKOUT REQUEST ID
            // ====================================================

            const checkoutRequestId =
                extractCheckoutRequestId(
                    result
                );


            if (
                !checkoutRequestId
            ) {

                console.error(
                    'payment.js: no checkout_request_id returned:',
                    result
                );


                throw new Error(
                    'Payment request was accepted but no M-Pesa checkout ID was returned by the server.'
                );
            }


            state.checkoutRequestId =
                String(
                    checkoutRequestId
                );


            // ====================================================
            // PAYMENT ID
            // ====================================================

            const paymentData =
                getPaymentData(
                    result
                );


            state.paymentId =
                firstDefined(

                    paymentData.payment_id,

                    result?.payment_id
                );


            console.log(
                'payment.js: checkout request ID:',
                state.checkoutRequestId
            );


            console.log(
                'payment.js: payment ID:',
                state.paymentId
            );


            // ====================================================
            // MEMBER NUMBER FROM BACKEND
            // ====================================================

            const memberNumberFromResult =
                firstDefined(

                    paymentData.member_number,

                    paymentData.member?.member_number,

                    result?.member_number,

                    result?.member?.member_number
                );


            if (
                memberNumberFromResult
            ) {

                if (
                    state.memberData
                ) {

                    state.memberData.member_number =
                        memberNumberFromResult;

                }

                if (
                    el.memberNumber
                ) {

                    el.memberNumber.textContent =
                        memberNumberFromResult;
                }
            }


            // ====================================================
            // SHOW PROCESSING CARD
            // ====================================================

            if (el.paymentCard) {

                el.paymentCard.style.display =
                    'none';
            }


            if (el.processingCard) {

                el.processingCard.style.display =
                    'block';
            }


            updateStep(
                2,
                'completed'
            );


            updateStep(
                3,
                'active'
            );


            if (el.processingTitle) {

                el.processingTitle.textContent =
                    'Check Your Phone';
            }


            if (el.processingMessage) {

                el.processingMessage.textContent =
                    'Please enter your M-Pesa PIN on the STK prompt sent to your phone.';
            }


            // ====================================================
            // POLL STATUS
            // ====================================================

            await pollPaymentStatus();

        }

        catch (error) {

            console.error(
                'payment.js: payment initiation failed:',
                error
            );


            updateStep(
                2,
                'error'
            );


            showAlert(
                'Payment initiation failed: ' +
                (
                    error.message ||
                    'Unknown error'
                ),
                'error'
            );


            if (el.payNowBtn) {

                el.payNowBtn.disabled =
                    false;

                el.payNowBtn.textContent =
                    'Pay Now';
            }


            state.isProcessing =
                false;
        }
    }


    // ============================================================
    // POLL PAYMENT STATUS
    // ============================================================
    // Uses sequential requests instead of setInterval so that
    // requests cannot overlap.
    // ============================================================

    async function pollPaymentStatus() {

        state.pollAttempts =
            0;


        while (
            state.pollAttempts <
            CONFIG.MAX_POLL_ATTEMPTS
        ) {

            state.pollAttempts++;


            console.log(
                `payment.js: checking payment status (${state.pollAttempts}/${CONFIG.MAX_POLL_ATTEMPTS})`
            );


            try {

                const result =
                    await apiRequest(

                        `/api/public/payment/status/${encodeURIComponent(
                            state.checkoutRequestId
                        )}`,

                        {
                            method:
                                'GET'
                        }
                    );


                console.log(
                    'payment.js: payment status response:',
                    result
                );


                const paymentStatus =
                    extractPaymentStatus(
                        result
                    );


                console.log(
                    'payment.js: normalized payment status:',
                    paymentStatus
                );


                // =================================================
                // SUCCESS
                // =================================================

                if (
                    SUCCESS_STATUSES.has(
                        paymentStatus
                    )
                ) {

                    await handlePaymentSuccess(
                        result
                    );

                    return;
                }


                // =================================================
                // FAILURE
                // =================================================

                if (
                    FAILURE_STATUSES.has(
                        paymentStatus
                    )
                ) {

                    await handlePaymentFailed(
                        result
                    );

                    return;
                }


                // =================================================
                // WAITING
                // =================================================

                if (
                    el.processingMessage
                ) {

                    const seconds =
                        Math.floor(
                            (
                                state.pollAttempts *
                                CONFIG.POLL_INTERVAL
                            ) / 1000
                        );


                    if (
                        state.pollAttempts <= 5
                    ) {

                        el.processingMessage.textContent =
                            'Waiting for M-Pesa confirmation...';

                    }

                    else {

                        el.processingMessage.textContent =
                            `Waiting for M-Pesa confirmation... (${seconds}s)`;
                    }
                }


            }

            catch (error) {

                console.warn(
                    'payment.js: payment polling error:',
                    error
                );


                // Continue polling unless this is the final attempt.

                if (
                    state.pollAttempts >=
                    CONFIG.MAX_POLL_ATTEMPTS
                ) {

                    handlePollingTimeout(
                        error
                    );

                    return;
                }
            }


            await sleep(
                CONFIG.POLL_INTERVAL
            );
        }


        handlePollingTimeout();
    }


    // ============================================================
    // POLLING TIMEOUT
    // ============================================================

    function handlePollingTimeout(error) {

        console.error(
            'payment.js: payment verification timed out.',
            error || ''
        );


        updateStep(
            3,
            'error'
        );


        if (el.processingCard) {

            el.processingCard.style.display =
                'none';
        }


        if (el.paymentCard) {

            el.paymentCard.style.display =
                'block';
        }


        if (el.payNowBtn) {

            el.payNowBtn.disabled =
                false;

            el.payNowBtn.textContent =
                'Retry Payment';
        }


        state.isProcessing =
            false;


        showAlert(
            'Payment verification timed out. Please check your M-Pesa messages before trying again.',
            'warning'
        );
    }


    // ============================================================
    // PAYMENT SUCCESS
    // ============================================================

    async function handlePaymentSuccess(
        result
    ) {

        console.log(
            'payment.js: PAYMENT SUCCESS:',
            result
        );


        state.paymentCompleted =
            true;


        updateStep(
            3,
            'completed'
        );


        updateStep(
            4,
            'active'
        );


        if (el.processingTitle) {

            el.processingTitle.textContent =
                'Payment Confirmed!';
        }


        if (el.processingMessage) {

            el.processingMessage.textContent =
                'Your payment has been successfully processed.';
        }


        await sleep(
            800
        );


        if (el.processingCard) {

            el.processingCard.style.display =
                'none';
        }


        if (el.successCard) {

            el.successCard.style.display =
                'block';
        }


        const paymentData =
            getPaymentData(
                result
            );


        // ========================================================
        // MEMBER NUMBER
        // ========================================================

        const finalMemberNumber =
            firstDefined(

                paymentData.member_number,

                paymentData.member?.member_number,

                result?.member_number,

                result?.member?.member_number,

                state.memberData?.member_number,

                getSession(
                    'newMemberNumber'
                ),

                state.memberId
            ) || '—';


        // ========================================================
        // RECEIPT
        // ========================================================

        const receipt =
            extractReceipt(
                result
            );


        // ========================================================
        // TRANSACTION ID
        // ========================================================

        const finalTransactionId =
            firstDefined(

                receipt,

                paymentData.transaction_id,

                paymentData.transactionId,

                result?.transaction_id,

                result?.transactionId,

                state.checkoutRequestId
            ) || '—';


        // ========================================================
        // AMOUNT
        // ========================================================

        const finalAmount =
            extractAmount(
                result
            );


        // ========================================================
        // DISPLAY SUCCESS DETAILS
        // ========================================================

        if (
            el.successMemberNumber
        ) {

            el.successMemberNumber.textContent =
                finalMemberNumber;
        }


        if (
            el.successTransactionId
        ) {

            el.successTransactionId.textContent =
                finalTransactionId;
        }


        if (
            el.successAmount
        ) {

            el.successAmount.textContent =
                formatMoney(
                    finalAmount
                );
        }


        // ========================================================
        // VIEW MEMBER BUTTON
        // ========================================================

        if (
            el.viewMemberBtn
        ) {

            el.viewMemberBtn.href =
                `member-details.html?id=${encodeURIComponent(
                    state.memberId
                )}`;


            el.viewMemberBtn.textContent =
                'View Member Details';
        }


        // ========================================================
        // CLEAR REGISTRATION SESSION
        // ========================================================

        clearRegistrationSession();


        // ========================================================
        // COMPLETE FINAL STEP
        // ========================================================

        updateStep(
            4,
            'completed'
        );


        state.isProcessing =
            false;


        console.log(
            'payment.js: payment completed successfully.'
        );
    }


    // ============================================================
    // CLEAR REGISTRATION SESSION
    // ============================================================

    function clearRegistrationSession() {

        const sessionKeys = [

            'newMemberId',

            'newMemberNumber',

            'newMemberName',

            'newMemberPhone',

            'registrationAmount',

            'registrationPlan',

            'registrationPlanName',

            'registrationType',

            'isChamaRegistration',

            'newChamaGroupId',

            'newChamaGroupName',

            'newChamaMemberCount',

            'newChamaPhone'
        ];


        sessionKeys.forEach(
            key => {

                try {

                    sessionStorage.removeItem(
                        key
                    );

                } catch (error) {

                    console.warn(
                        `payment.js: unable to remove session key ${key}:`,
                        error
                    );
                }
            }
        );


        console.log(
            'payment.js: registration session cleared after successful payment.'
        );
    }


    // ============================================================
    // PAYMENT FAILED
    // ============================================================

    async function handlePaymentFailed(
        result
    ) {

        console.error(
            'payment.js: PAYMENT FAILED:',
            result
        );


        updateStep(
            3,
            'error'
        );


        const reason =
            extractPaymentMessage(
                result
            );


        showAlert(
            'Payment failed: ' +
            (
                reason ||
                'Please try again.'
            ),
            'error'
        );


        await sleep(
            1200
        );


        if (el.processingCard) {

            el.processingCard.style.display =
                'none';
        }


        if (el.paymentCard) {

            el.paymentCard.style.display =
                'block';
        }


        if (el.payNowBtn) {

            el.payNowBtn.disabled =
                false;

            el.payNowBtn.textContent =
                'Retry Payment';
        }


        state.isProcessing =
            false;
    }


    // ============================================================
    // CANCEL PAYMENT
    // ============================================================

    function cancelPayment() {

        console.log(
            'payment.js: cancel payment clicked.'
        );


        if (el.processingCard) {

            el.processingCard.style.display =
                'none';
        }


        if (el.paymentCard) {

            el.paymentCard.style.display =
                'block';
        }


        if (el.payNowBtn) {

            el.payNowBtn.disabled =
                false;

            el.payNowBtn.textContent =
                'Pay Now';
        }


        state.isProcessing =
            false;


        updateStep(
            2,
            ''
        );


        updateStep(
            3,
            ''
        );


        updateStep(
            1,
            'completed'
        );


        showAlert(
            'Payment was cancelled. If you already approved the M-Pesa prompt, please wait for confirmation before attempting another payment.',
            'info'
        );
    }


    // ============================================================
    // PHONE VALIDATION UI
    // ============================================================

    function validatePhoneInput() {

        if (
            !el.mpesaPhone
        ) {

            return false;
        }


        const phone =
            el.mpesaPhone.value;


        if (
            !phone
        ) {

            if (el.phoneError) {

                el.phoneError.classList.remove(
                    'show'
                );
            }


            el.mpesaPhone.classList.remove(
                'input-error'
            );


            if (el.payNowBtn) {

                el.payNowBtn.disabled =
                    true;
            }


            return false;
        }


        const isValid =
            validatePhone(
                phone
            );


        if (
            isValid
        ) {

            if (el.phoneError) {

                el.phoneError.classList.remove(
                    'show'
                );
            }


            el.mpesaPhone.classList.remove(
                'input-error'
            );


            if (
                el.payNowBtn &&
                state.amount > 0 &&
                !state.isProcessing
            ) {

                el.payNowBtn.disabled =
                    false;
            }


            return true;
        }


        if (el.phoneError) {

            el.phoneError.classList.add(
                'show'
            );
        }


        el.mpesaPhone.classList.add(
            'input-error'
        );


        if (el.payNowBtn) {

            el.payNowBtn.disabled =
                true;
        }


        return false;
    }


    // ============================================================
    // ATTACH EVENT HANDLERS
    // ============================================================

    function attachEventHandlers() {

        console.log(
            'payment.js: attaching event handlers...'
        );


        // --------------------------------------------------------
        // YEAR
        // --------------------------------------------------------

        if (el.year) {

            el.year.textContent =
                new Date().getFullYear();
        }


        // --------------------------------------------------------
        // PHONE INPUT
        // --------------------------------------------------------

        if (el.mpesaPhone) {

            el.mpesaPhone.addEventListener(
                'input',
                validatePhoneInput
            );


            el.mpesaPhone.addEventListener(
                'blur',
                validatePhoneInput
            );
        }


        // --------------------------------------------------------
        // PAYMENT FORM
        // --------------------------------------------------------

        if (el.paymentForm) {

            console.log(
                'payment.js: payment form found.'
            );


            el.paymentForm.addEventListener(
                'submit',
                async event => {

                    event.preventDefault();

                    event.stopPropagation();


                    console.log(
                        'payment.js: PAYMENT FORM SUBMITTED'
                    );


                    await initiatePayment();
                }
            );

        }

        else {

            console.warn(
                'payment.js: #paymentForm not found.'
            );
        }


        // --------------------------------------------------------
        // PAY NOW BUTTON
        // --------------------------------------------------------

        if (el.payNowBtn) {

            console.log(
                'payment.js: Pay Now button found.'
            );


            el.payNowBtn.addEventListener(
                'click',
                async event => {

                    event.preventDefault();

                    event.stopPropagation();


                    console.log(
                        'payment.js: PAY NOW CLICKED'
                    );


                    // If the button is inside a form,
                    // submit handler may also fire.
                    //
                    // state.isProcessing protects against
                    // duplicate API requests.

                    await initiatePayment();
                }
            );

        }

        else {

            console.warn(
                'payment.js: #payNowBtn not found.'
            );
        }


        // --------------------------------------------------------
        // BACK BUTTON
        // --------------------------------------------------------

        if (el.backBtn) {

            el.backBtn.addEventListener(
                'click',
                event => {

                    event.preventDefault();


                    if (
                        state.isChama
                    ) {

                        window.location.href =
                            'register.html?mode=chama';

                    }

                    else {

                        window.location.href =
                            'register.html';
                    }
                }
            );
        }


        // --------------------------------------------------------
        // CANCEL PAYMENT
        // --------------------------------------------------------

        if (
            el.cancelPaymentBtn
        ) {

            el.cancelPaymentBtn.addEventListener(
                'click',
                event => {

                    event.preventDefault();

                    cancelPayment();
                }
            );
        }


        // --------------------------------------------------------
        // PREVENT ACCIDENTAL PAGE LEAVE
        // --------------------------------------------------------

        window.addEventListener(
            'beforeunload',
            event => {

                if (
                    state.isProcessing &&
                    !state.paymentCompleted
                ) {

                    event.preventDefault();

                    event.returnValue =
                        'Payment is being processed. Are you sure you want to leave?';
                }
            }
        );
    }


    // ============================================================
    // INITIALIZATION
    // ============================================================
    //
    // IMPORTANT FIX:
    //
    // Do NOT rely exclusively on DOMContentLoaded.
    //
    // If this script is loaded after DOMContentLoaded has already
    // fired, the old code never initialized.
    //
    // This version checks document.readyState and initializes
    // immediately when the DOM is already ready.
    // ============================================================

    function initializePaymentPage() {

        if (
            state.initialized
        ) {

            console.warn(
                'payment.js: initialization already completed.'
            );

            return;
        }


        state.initialized =
            true;


        console.log(
            'payment.js: INITIALIZING PAYMENT PAGE'
        );


        // --------------------------------------------------------
        // LOAD DOM
        // --------------------------------------------------------

        loadDomReferences();


        // --------------------------------------------------------
        // RESET PAYMENT CARDS
        // --------------------------------------------------------

        if (
            el.successCard
        ) {

            el.successCard.style.display =
                'none';
        }


        if (
            el.processingCard
        ) {

            el.processingCard.style.display =
                'none';
        }


        if (
            el.paymentCard
        ) {

            el.paymentCard.style.display =
                'block';
        }


        // --------------------------------------------------------
        // RESET STEPS
        // --------------------------------------------------------

        resetSteps();


        // --------------------------------------------------------
        // ATTACH HANDLERS BEFORE LOADING DATA
        // --------------------------------------------------------

        attachEventHandlers();


        // --------------------------------------------------------
        // LOAD SESSION DATA
        // --------------------------------------------------------

        try {

            loadPaymentData();

        }

        catch (error) {

            console.error(
                'payment.js: initialization failed:',
                error
            );


            showAlert(
                'Could not initialize payment page: ' +
                (
                    error.message ||
                    'Unknown error'
                ),
                'error'
            );


            if (el.payNowBtn) {

                el.payNowBtn.disabled =
                    true;
            }


            return;
        }


        // --------------------------------------------------------
        // FINAL DEBUG
        // --------------------------------------------------------

        console.log(
            'payment.js: INITIALIZATION COMPLETE',
            {
                memberId:
                    state.memberId,

                groupId:
                    state.groupId,

                isChama:
                    state.isChama,

                amount:
                    state.amount,

                memberName:
                    el.memberName?.textContent,

                memberNumber:
                    el.memberNumber?.textContent,

                plan:
                    el.memberPlan?.textContent,

                registrationType:
                    el.registrationType?.textContent,

                phone:
                    el.mpesaPhone?.value
            }
        );
    }


    // ============================================================
    // START APPLICATION
    // ============================================================

    if (
        document.readyState ===
        'loading'
    ) {

        console.log(
            'payment.js: DOM still loading — waiting for DOMContentLoaded.'
        );


        document.addEventListener(
            'DOMContentLoaded',
            initializePaymentPage,
            {
                once: true
            }
        );

    }

    else {

        console.log(
            'payment.js: DOM already ready — initializing immediately.'
        );


        initializePaymentPage();
    }


})();
```

This version is aligned with the current FastAPI contract and, importantly, fixes the initialization path that can leave the page permanently showing `Loading…`.

**After replacing the file:**

1. Save it as exactly:
   `js/payment.js`
2. Deploy/push the change.
3. Open the payment page and do **Ctrl + Shift + R**.
4. In the browser console you should immediately see:
   `payment.js: MASIKA PAYMENT SCRIPT LOADED — FIXED BUILD 2026-09-06`
5. Then you should see:
   `payment.js: INITIALIZING PAYMENT PAGE`
6. Then something like:
   `payment.js: individual payment data loaded`
7. The page should populate with the member number, name, actual plan, and registration amount from `sessionStorage`.

One important point: **do not change `register.html` again yet.** The registration page is already handing off `newMemberId`, `newMemberNumber`, `registrationAmount`, `registrationPlanName`, etc. The corrected payment script now reads those exact values.
