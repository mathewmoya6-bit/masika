```javascript
// ============================================================
// PAYMENT PAGE LOGIC — MASIKA BENEVOLENT
// ------------------------------------------------------------
// FastAPI payment contract:
//
//   POST /api/public/payment/stk-push
//   GET  /api/public/payment/status/{checkout_request_id}
//
// Registration data comes from sessionStorage:
//
//   newMemberId
//   newMemberNumber
//   newMemberName
//   newMemberPhone
//   newChamaGroupId
//   newChamaGroupName
//   newChamaMemberCount
//   newChamaPhone
//   registrationAmount
//   isChamaRegistration
//
// IMPORTANT:
// - No Daraja credentials are stored here.
// - M-Pesa STK Push is handled by FastAPI.
// - Frontend only communicates with the public payment API.
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
    // DOM HELPERS
    // ============================================================

    const $ = id =>
        document.getElementById(id);


    const el = {

        alertBox:
            $('alertBox'),

        paymentForm:
            $('paymentForm'),

        paymentCard:
            $('paymentCard'),

        processingCard:
            $('processingCard'),

        successCard:
            $('successCard'),


        memberName:
            $('memberName'),

        memberNumber:
            $('memberNumber'),

        memberPlan:
            $('memberPlan'),

        registrationType:
            $('registrationType'),

        paymentAmount:
            $('paymentAmount'),


        mpesaPhone:
            $('mpesaPhone'),

        phoneError:
            $('phoneError'),

        payNowBtn:
            $('payNowBtn'),

        backBtn:
            $('backBtn'),

        cancelPaymentBtn:
            $('cancelPaymentBtn'),


        processingTitle:
            $('processingTitle'),

        processingMessage:
            $('processingMessage'),


        successMemberNumber:
            $('successMemberNumber'),

        successTransactionId:
            $('successTransactionId'),

        successAmount:
            $('successAmount'),

        viewMemberBtn:
            $('viewMemberBtn'),


        year:
            $('year'),


        step1Circle:
            $('step1Circle'),

        step2Circle:
            $('step2Circle'),

        step3Circle:
            $('step3Circle'),

        step4Circle:
            $('step4Circle'),


        step1Label:
            $('step1Label'),

        step2Label:
            $('step2Label'),

        step3Label:
            $('step3Label'),

        step4Label:
            $('step4Label')
    };


    // ============================================================
    // DOM VALIDATION
    // ============================================================

    Object.entries(el).forEach(
        ([key, node]) => {

            if (!node) {

                console.error(
                    `payment.js: expected element #${key} was not found in the DOM.`
                );
            }
        }
    );


    // ============================================================
    // STATE
    // ============================================================

    const state = {

        memberId:
            null,

        groupId:
            null,

        isChama:
            false,

        amount:
            0,

        memberData:
            null,

        // Safaricom CheckoutRequestID
        checkoutRequestId:
            null,

        paymentId:
            null,

        isProcessing:
            false,

        pollInterval:
            null,

        pollAttempts:
            0
    };


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
                .replace(/\s+/g, '')
                .replace(/-/g, '');


        if (!value) {
            return '';
        }


        // +254712345678
        // -> 254712345678

        if (
            value.startsWith('+254')
        ) {

            value =
                value.substring(1);
        }


        // 0712345678
        // -> 254712345678

        if (
            value.startsWith('0')
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
                '254' + value;
        }


        return value;
    }


    function validatePhone(phone) {

        const normalized =
            normalizePhone(phone);


        return /^254\d{9}$/.test(
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
                setTimeout(resolve, ms)
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


    // ============================================================
    // PAYMENT RESPONSE HELPERS
    // ============================================================

    function getPaymentData(result) {

        return (
            result?.data ||
            result ||
            {}
        );
    }


    function extractCheckoutRequestId(
        result
    ) {

        const data =
            getPaymentData(result);


        return firstDefined(

            data.checkout_request_id,

            data.CheckoutRequestID,

            result?.checkout_request_id,

            result?.CheckoutRequestID,

            data.transaction_id,

            data.transactionId,

            result?.transaction_id,

            result?.transactionId
        );
    }


    function extractPaymentStatus(
        result
    ) {

        const data =
            getPaymentData(result);


        const raw =
            firstDefined(

                data.status,

                data.payment_status,

                data.paymentStatus,

                data.result,

                data.state,

                result?.status,

                result?.payment_status,

                result?.paymentStatus,

                result?.result,

                result?.state
            );


        return String(
            raw || ''
        )
            .trim()
            .toLowerCase();
    }


    function extractPaymentMessage(
        result
    ) {

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


    function extractReceipt(
        result
    ) {

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


    function extractAmount(
        result
    ) {

        const data =
            getPaymentData(result);


        return firstDefined(

            data.amount,

            result?.amount,

            state.amount
        );
    }


    // ============================================================
    // PAYMENT STATUS DEFINITIONS
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

    const CIRCLES = {

        1:
            el.step1Circle,

        2:
            el.step2Circle,

        3:
            el.step3Circle,

        4:
            el.step4Circle
    };


    const LABELS = {

        1:
            el.step1Label,

        2:
            el.step2Label,

        3:
            el.step3Label,

        4:
            el.step4Label
    };


    function updateStep(
        step,
        status
    ) {

        const circle =
            CIRCLES[step];

        const label =
            LABELS[step];


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
    }


    function resetSteps() {

        for (
            let i = 1;
            i <= 4;
            i++
        ) {

            const circle =
                CIRCLES[i];

            const label =
                LABELS[i];


            if (circle) {

                circle.className =
                    'circle';

                circle.textContent =
                    i;
            }


            if (label) {

                label.className =
                    'label';
            }
        }


        updateStep(
            1,
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
                () =>
                    controller.abort(),
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

                            ...(options.headers || {})
                        },

                        signal:
                            controller.signal
                    }
                );


            clearTimeout(timer);


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


            // ----------------------------------------------------
            // HTTP ERROR
            // ----------------------------------------------------

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


                console.error(
                    `payment.js: ${endpoint} returned HTTP ${response.status}:`,
                    result ||
                    responseText
                );


                throw new Error(

                    message ||

                    `Server returned HTTP ${response.status}.`
                );
            }


            return result;

        }

        catch (error) {

            clearTimeout(timer);


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
    }


    // ============================================================
    // LOAD PAYMENT DATA
    // ============================================================

    async function loadPaymentData() {

        console.log(
            'payment.js: loading payment data...'
        );


        const params =
            new URLSearchParams(
                window.location.search
            );


        // --------------------------------------------------------
        // MEMBER / GROUP
        // --------------------------------------------------------

        state.memberId =
            params.get('member_id') ||
            sessionStorage.getItem(
                'newMemberId'
            );


        state.groupId =
            params.get('group_id') ||
            sessionStorage.getItem(
                'newChamaGroupId'
            );


        state.isChama =
            !!state.groupId &&
            !state.memberId;


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


        if (
            !state.memberId &&
            !state.groupId
        ) {

            showAlert(
                'No registration specified. Please restart the registration process.',
                'error'
            );


            if (el.payNowBtn) {
                el.payNowBtn.disabled =
                    true;
            }


            return;
        }


        // --------------------------------------------------------
        // SESSION DATA
        // --------------------------------------------------------

        try {

            const storedAmount =
                Number(
                    sessionStorage.getItem(
                        'registrationAmount'
                    ) || 0
                );


            const storedMemberNumber =
                sessionStorage.getItem(
                    'newMemberNumber'
                ) || '';


            const storedMemberName =
                sessionStorage.getItem(
                    'newMemberName'
                ) || '';


            const storedMemberPhone =
                sessionStorage.getItem(
                    'newMemberPhone'
                ) || '';


            const storedGroupName =
                sessionStorage.getItem(
                    'newChamaGroupName'
                ) || '';


            const storedGroupPhone =
                sessionStorage.getItem(
                    'newChamaPhone'
                ) || '';


            state.amount =
                storedAmount;


            state.memberData = {

                id:
                    state.memberId ||
                    state.groupId,

                member_number:
                    storedMemberNumber,

                full_name:
                    storedMemberName,

                group_name:
                    storedGroupName
            };


            console.log(
                'payment.js: session data:',
                {
                    amount:
                        state.amount,

                    memberNumber:
                        storedMemberNumber,

                    memberName:
                        storedMemberName,

                    memberPhone:
                        storedMemberPhone,

                    groupName:
                        storedGroupName
                }
            );


            // ----------------------------------------------------
            // CHAMA
            // ----------------------------------------------------

            if (
                state.isChama
            ) {

                if (el.memberName) {

                    el.memberName.textContent =
                        storedGroupName ||
                        'Chama Group';
                }


                if (el.memberNumber) {

                    el.memberNumber.textContent =
                        state.groupId ||
                        '—';
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
                    storedGroupPhone &&
                    el.mpesaPhone &&
                    !el.mpesaPhone.value
                ) {

                    el.mpesaPhone.value =
                        storedGroupPhone;
                }
            }


            // ----------------------------------------------------
            // INDIVIDUAL
            // ----------------------------------------------------

            else {

                if (el.memberName) {

                    el.memberName.textContent =
                        storedMemberName ||
                        'Member';
                }


                if (el.memberNumber) {

                    el.memberNumber.textContent =
                        storedMemberNumber ||
                        'Pending';
                }


                if (el.registrationType) {

                    el.registrationType.textContent =
                        'Individual / Family';
                }


                if (el.memberPlan) {

                    el.memberPlan.textContent =
                        'Registration';
                }


                if (
                    storedMemberPhone &&
                    el.mpesaPhone &&
                    !el.mpesaPhone.value
                ) {

                    el.mpesaPhone.value =
                        storedMemberPhone;
                }
            }


            // ----------------------------------------------------
            // AMOUNT
            // ----------------------------------------------------

            if (el.paymentAmount) {

                el.paymentAmount.textContent =
                    formatMoney(
                        state.amount
                    );
            }


            if (
                state.amount <= 0
            ) {

                console.warn(
                    'payment.js: registrationAmount is missing or zero.'
                );


                showAlert(
                    'No registration payment amount was found. Please restart registration.',
                    'warning'
                );


                if (el.payNowBtn) {

                    el.payNowBtn.disabled =
                        true;
                }


                return;
            }


            // Amount exists.

            if (el.payNowBtn) {

                el.payNowBtn.disabled =
                    false;
            }


            clearAlert();


            validatePhoneInput();


            console.log(
                'payment.js: payment data loaded successfully.'
            );

        }

        catch (error) {

            console.error(
                'payment.js: failed to load payment data:',
                error
            );


            showAlert(
                'Could not load payment details: ' +
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
        }
    }


    // ============================================================
    // INITIATE STK PUSH
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


        if (
            !el.mpesaPhone
        ) {

            showAlert(
                'M-Pesa phone input was not found.',
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


        // --------------------------------------------------------
        // VALIDATE PHONE
        // --------------------------------------------------------

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


        // --------------------------------------------------------
        // VALIDATE MEMBER
        // --------------------------------------------------------

        if (
            !state.isChama &&
            !state.memberId
        ) {

            showAlert(
                'Member information is missing. Please restart registration.',
                'error'
            );

            return;
        }


        // --------------------------------------------------------
        // VALIDATE AMOUNT
        // --------------------------------------------------------

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


        // --------------------------------------------------------
        // LOCK PAYMENT
        // --------------------------------------------------------

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


        // --------------------------------------------------------
        // BUILD REQUEST
        // --------------------------------------------------------

        const payload = {

            amount:
                state.amount,

            phone:
                phone
        };


        if (
            state.isChama
        ) {

            // NOTE:
            // The current FastAPI StkPushRequest shown earlier
            // accepts member_id, not group_id.
            //
            // This branch therefore requires a corresponding
            // Chama payment backend before Chama STK payments
            // can work.

            payload.group_id =
                state.groupId;

            payload.payment_type =
                'chama_registration';

        }

        else {

            payload.member_id =
                state.memberId;

            payload.payment_type =
                'registration';
        }


        console.log(
            'payment.js: initiating STK payment:',
            {
                amount:
                    payload.amount,

                member_id:
                    payload.member_id,

                group_id:
                    payload.group_id,

                payment_type:
                    payload.payment_type,

                phone:
                    payload.phone
            }
        );


        try {

            // ====================================================
            // FASTAPI STK PUSH ENDPOINT
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


            // ----------------------------------------------------
            // BACKEND FAILURE
            // ----------------------------------------------------

            if (
                result?.success === false
            ) {

                throw new Error(

                    result?.message ||

                    result?.error ||

                    'Payment initiation failed.'
                );
            }


            // ----------------------------------------------------
            // CHECKOUT REQUEST ID
            // ----------------------------------------------------

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
                    'Payment request was accepted but no M-Pesa checkout ID was returned.'
                );
            }


            state.checkoutRequestId =
                checkoutRequestId;


            // ----------------------------------------------------
            // PAYMENT ID
            // ----------------------------------------------------

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


            // ----------------------------------------------------
            // MEMBER NUMBER
            // ----------------------------------------------------

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

                state.memberData = {

                    ...(state.memberData || {}),

                    member_number:
                        memberNumberFromResult
                };
            }


            // ----------------------------------------------------
            // SHOW PROCESSING SCREEN
            // ----------------------------------------------------

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


            // ----------------------------------------------------
            // POLL PAYMENT STATUS
            // ----------------------------------------------------

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

    function pollPaymentStatus() {

        state.pollAttempts =
            0;


        return new Promise(
            (resolve, reject) => {

                // Prevent duplicate polling.

                if (
                    state.pollInterval
                ) {

                    clearInterval(
                        state.pollInterval
                    );

                    state.pollInterval =
                        null;
                }


                state.pollInterval =
                    setInterval(

                        async () => {

                            state.pollAttempts++;


                            console.log(
                                `payment.js: checking payment status (${state.pollAttempts}/${CONFIG.MAX_POLL_ATTEMPTS})`
                            );


                            try {

                                // =================================
                                // FASTAPI STATUS ENDPOINT
                                // =================================

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


                                // ---------------------------------
                                // SUCCESS
                                // ---------------------------------

                                if (
                                    SUCCESS_STATUSES.has(
                                        paymentStatus
                                    )
                                ) {

                                    clearInterval(
                                        state.pollInterval
                                    );


                                    state.pollInterval =
                                        null;


                                    await handlePaymentSuccess(
                                        result
                                    );


                                    resolve();

                                    return;
                                }


                                // ---------------------------------
                                // FAILURE
                                // ---------------------------------

                                if (
                                    FAILURE_STATUSES.has(
                                        paymentStatus
                                    )
                                ) {

                                    clearInterval(
                                        state.pollInterval
                                    );


                                    state.pollInterval =
                                        null;


                                    await handlePaymentFailed(
                                        result
                                    );


                                    reject(

                                        new Error(
                                            extractPaymentMessage(
                                                result
                                            )
                                        )
                                    );


                                    return;
                                }


                                // ---------------------------------
                                // WAITING
                                // ---------------------------------

                                if (
                                    !paymentStatus
                                ) {

                                    console.warn(
                                        'payment.js: no recognizable payment status:',
                                        result
                                    );
                                }


                                if (
                                    state.pollAttempts > 5
                                ) {

                                    const seconds =
                                        Math.floor(

                                            state.pollAttempts *
                                            CONFIG.POLL_INTERVAL /
                                            1000
                                        );


                                    if (
                                        el.processingMessage
                                    ) {

                                        el.processingMessage.textContent =
                                            `Waiting for M-Pesa confirmation... (${seconds}s)`;
                                    }
                                }


                                // ---------------------------------
                                // TIMEOUT
                                // ---------------------------------

                                if (
                                    state.pollAttempts >=
                                    CONFIG.MAX_POLL_ATTEMPTS
                                ) {

                                    clearInterval(
                                        state.pollInterval
                                    );


                                    state.pollInterval =
                                        null;


                                    showAlert(
                                        'Payment verification timed out. Please check your M-Pesa messages before trying again.',
                                        'warning'
                                    );


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


                                    if (
                                        el.payNowBtn
                                    ) {

                                        el.payNowBtn.disabled =
                                            false;

                                        el.payNowBtn.textContent =
                                            'Retry Payment';
                                    }


                                    state.isProcessing =
                                        false;


                                    updateStep(
                                        3,
                                        'error'
                                    );


                                    reject(

                                        new Error(
                                            'Payment verification timed out.'
                                        )
                                    );
                                }

                            }

                            catch (error) {

                                // ---------------------------------
                                // DO NOT IMMEDIATELY FAIL
                                // ---------------------------------

                                console.warn(
                                    'payment.js: payment polling error:',
                                    error
                                );


                                if (
                                    state.pollAttempts >=
                                    CONFIG.MAX_POLL_ATTEMPTS
                                ) {

                                    clearInterval(
                                        state.pollInterval
                                    );


                                    state.pollInterval =
                                        null;


                                    showAlert(
                                        'Unable to verify the payment. Please check your M-Pesa messages before retrying.',
                                        'warning'
                                    );


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


                                    if (
                                        el.payNowBtn
                                    ) {

                                        el.payNowBtn.disabled =
                                            false;

                                        el.payNowBtn.textContent =
                                            'Retry Payment';
                                    }


                                    state.isProcessing =
                                        false;


                                    updateStep(
                                        3,
                                        'error'
                                    );


                                    reject(
                                        error
                                    );
                                }
                            }

                        },

                        CONFIG.POLL_INTERVAL
                    );
            }
        );
    }


    // ============================================================
    // PAYMENT SUCCESS
    // ============================================================

    async function handlePaymentSuccess(
        result
    ) {

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


        await sleep(1000);


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


        // --------------------------------------------------------
        // MEMBER NUMBER
        // --------------------------------------------------------

        const finalMemberNumber =
            firstDefined(

                paymentData.member_number,

                paymentData.member?.member_number,

                result?.member_number,

                result?.member?.member_number,

                state.memberData?.member_number,

                sessionStorage.getItem(
                    'newMemberNumber'
                ),

                state.isChama
                    ? state.groupId
                    : state.memberId
            ) || '—';


        // --------------------------------------------------------
        // RECEIPT
        // --------------------------------------------------------

        const receipt =
            extractReceipt(
                result
            );


        // --------------------------------------------------------
        // TRANSACTION ID
        // --------------------------------------------------------

        const finalTransactionId =
            firstDefined(

                receipt,

                paymentData.transaction_id,

                paymentData.transactionId,

                result?.transaction_id,

                result?.transactionId,

                state.checkoutRequestId
            ) || '—';


        // --------------------------------------------------------
        // AMOUNT
        // --------------------------------------------------------

        const finalAmount =
            extractAmount(
                result
            );


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


        // --------------------------------------------------------
        // VIEW DETAILS
        // --------------------------------------------------------

        if (
            el.viewMemberBtn
        ) {

            if (
                state.isChama
            ) {

                el.viewMemberBtn.href =
                    `chama-details.html?id=${encodeURIComponent(
                        state.groupId
                    )}`;


                el.viewMemberBtn.textContent =
                    'View Chama Details';

            }

            else {

                el.viewMemberBtn.href =
                    `member-details.html?id=${encodeURIComponent(
                        state.memberId
                    )}`;


                el.viewMemberBtn.textContent =
                    'View Member Details';
            }
        }


        // --------------------------------------------------------
        // CLEAR REGISTRATION SESSION
        // --------------------------------------------------------

        const sessionKeys = [

            'newMemberId',

            'newMemberNumber',

            'newMemberName',

            'newMemberPhone',

            'newChamaGroupId',

            'newChamaGroupName',

            'newChamaMemberCount',

            'newChamaPhone',

            'registrationAmount',

            'isChamaRegistration'
        ];


        sessionKeys.forEach(
            key =>
                sessionStorage.removeItem(
                    key
                )
        );


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
    // PAYMENT FAILED
    // ============================================================

    async function handlePaymentFailed(
        result
    ) {

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


        await sleep(1500);


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


        if (
            el.payNowBtn
        ) {

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


        if (
            state.pollInterval
        ) {

            clearInterval(
                state.pollInterval
            );

            state.pollInterval =
                null;
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


        if (
            el.payNowBtn
        ) {

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
            1,
            'active'
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

            return;
        }


        const phone =
            el.mpesaPhone.value;


        if (
            phone.length >= 9
        ) {

            const isValid =
                validatePhone(
                    phone
                );


            if (
                isValid
            ) {

                if (
                    el.phoneError
                ) {

                    el.phoneError.classList.remove(
                        'show'
                    );
                }


                el.mpesaPhone.classList.remove(
                    'input-error'
                );


                if (
                    el.payNowBtn
                ) {

                    el.payNowBtn.disabled =
                        state.amount <= 0;
                }

            }

            else {

                if (
                    el.phoneError
                ) {

                    el.phoneError.classList.add(
                        'show'
                    );
                }


                el.mpesaPhone.classList.add(
                    'input-error'
                );


                if (
                    el.payNowBtn
                ) {

                    el.payNowBtn.disabled =
                        true;
                }
            }

        }

        else {

            if (
                el.phoneError
            ) {

                el.phoneError.classList.remove(
                    'show'
                );
            }


            el.mpesaPhone.classList.remove(
                'input-error'
            );


            if (
                el.payNowBtn
            ) {

                el.payNowBtn.disabled =
                    true;
            }
        }
    }


    // ============================================================
    // INITIALIZATION
    // ============================================================
    //
    // IMPORTANT:
    // Event handlers are attached BEFORE loadPaymentData().
    //
    // This means a failure while loading session data cannot
    // prevent the payment form from being initialized.
    // ============================================================

    document.addEventListener(
        'DOMContentLoaded',
        () => {

            console.log(
                'payment.js: DOMContentLoaded'
            );


            // ----------------------------------------------------
            // YEAR
            // ----------------------------------------------------

            if (
                el.year
            ) {

                el.year.textContent =
                    new Date().getFullYear();
            }


            // ----------------------------------------------------
            // RESET STEPS
            // ----------------------------------------------------

            resetSteps();


            // ----------------------------------------------------
            // PHONE INPUT
            // ----------------------------------------------------

            if (
                el.mpesaPhone
            ) {

                el.mpesaPhone.addEventListener(
                    'input',
                    () => {

                        console.log(
                            'payment.js: phone input changed'
                        );


                        validatePhoneInput();
                    }
                );


                el.mpesaPhone.addEventListener(
                    'blur',
                    validatePhoneInput
                );
            }

            else {

                console.error(
                    'payment.js: #mpesaPhone was NOT found.'
                );
            }


            // ----------------------------------------------------
            // PAYMENT FORM
            // ----------------------------------------------------

            if (
                el.paymentForm
            ) {

                console.log(
                    'payment.js: payment form found:',
                    el.paymentForm
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

                console.error(
                    'payment.js: #paymentForm was NOT found.'
                );
            }


            // ----------------------------------------------------
            // PAY NOW BUTTON
            // ----------------------------------------------------
            //
            // Direct click fallback.
            //
            // If the HTML button is not configured as type="submit",
            // the payment will still initiate.
            //
            // If it is a submit button, the state.isProcessing
            // guard prevents duplicate API calls.
            // ----------------------------------------------------

            if (
                el.payNowBtn
            ) {

                console.log(
                    'payment.js: Pay Now button found:',
                    el.payNowBtn
                );


                el.payNowBtn.addEventListener(
                    'click',
                    async event => {

                        event.preventDefault();
                        event.stopPropagation();


                        console.log(
                            'payment.js: PAY NOW CLICKED'
                        );


                        await initiatePayment();
                    }
                );

            }

            else {

                console.error(
                    'payment.js: #payNowBtn was NOT found.'
                );
            }


            // ----------------------------------------------------
            // BACK BUTTON
            // ----------------------------------------------------

            if (
                el.backBtn
            ) {

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


            // ----------------------------------------------------
            // CANCEL PAYMENT
            // ----------------------------------------------------

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


            // ----------------------------------------------------
            // PREVENT ACCIDENTAL PAGE LEAVE
            // ----------------------------------------------------

            window.addEventListener(
                'beforeunload',
                event => {

                    if (
                        state.isProcessing
                    ) {

                        event.preventDefault();


                        event.returnValue =
                            'Payment is being processed. Are you sure you want to leave?';
                    }
                }
            );


            // ----------------------------------------------------
            // LOAD PAYMENT DATA
            // ----------------------------------------------------
            //
            // This is deliberately LAST.
            // All event handlers are already installed.
            // ----------------------------------------------------

            loadPaymentData()
                .then(
                    () => {

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

                                phone:
                                    el.mpesaPhone
                                        ?.value
                            }
                        );
                    }
                )
                .catch(
                    error => {

                        console.error(
                            'payment.js: initialization error:',
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


                        if (
                            el.payNowBtn
                        ) {

                            el.payNowBtn.disabled =
                                true;
                        }
                    }
                );
        }
    );

})();
```
