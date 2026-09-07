# ============================================================
# MASIKA BBS - SYSTEM CONSTANTS
# ============================================================

class PlanConstants:
    """Membership plan constants"""
    
    PLANS = {
        "comfort": {
            "name": "Masika Comfort Plan",
            "slug": "comfort",
            "monthly_fee": 300,
            "registration_fee": 200,
            "waiting_period_months": 4,
            "max_age": 69,
            "min_age": 1,
            "cash_benefit_adult": 110000,
            "cash_benefit_child": 50000,
            "features": [
                "Main member + spouse + up to 4 children (under 18)",
                "Hearse transportation within Kenya",
                "Mortuary storage up to 14 days (max KES 15,000)",
                "Tents & chairs for up to 200 people",
                "Gazebo & lowering gear",
                "Flowers (Heart, Round, Cross)",
                "PA system (max KES 5,000)",
                "Memorial portrait",
                "Coffin/casket (child KES 10,000 / adult KES 25,000)"
            ]
        },
        "dignity": {
            "name": "Masika Dignity Plan",
            "slug": "dignity",
            "monthly_fee": 1000,
            "registration_fee": 500,
            "waiting_period_months": 6,
            "max_age": 80,
            "min_age": 70,
            "cash_benefit_adult": 110000,
            "cash_benefit_child": 50000,
            "features": [
                "Spouse + children under 18",
                "Hearse transportation within Kenya",
                "Mortuary storage up to 14 days (max KES 15,000)",
                "Tents & chairs for up to 200 people",
                "Gazebo & lowering gear",
                "Flowers (Heart, Round, Cross)",
                "PA system (max KES 5,000)",
                "Memorial portrait",
                "Coffin/casket (child KES 10,000 / adult KES 25,000)"
            ]
        },
        "wazazi": {
            "name": "Masika Wazazi Plan",
            "slug": "wazazi",
            "monthly_fee": 350,
            "registration_fee": 100,
            "waiting_period_months": 6,
            "max_age": 70,
            "min_age": 40,
            "cash_benefit_adult": 110000,
            "cash_benefit_child": 50000,
            "features": [
                "Covers parents / in-laws (max 4 parents)",
                "Hearse transportation within Kenya",
                "Mortuary storage up to 14 days (max KES 15,000)",
                "Tents & chairs for up to 200 people",
                "Gazebo & lowering gear",
                "Flowers (Heart, Round, Cross)",
                "PA system (max KES 5,000)",
                "Memorial portrait",
                "Coffin/casket (child KES 10,000 / adult KES 25,000)"
            ]
        }
    }

class PaymentConstants:
    """Payment-related constants"""
    
    PAYMENT_TYPES = {
        "registration": "Registration Fee",
        "monthly": "Monthly Subscription",
        "addon": "Add-on Payment",
        "agent_commission": "Agent Commission"
    }
    
    PAYMENT_STATUS = {
        "pending": "Pending",
        "completed": "Completed",
        "failed": "Failed",
        "refunded": "Refunded",
        "cancelled": "Cancelled"
    }
    
    M_PESA = {
        "shortcode": "348127",
        "transaction_type": "CustomerPayBillOnline",
        "description": "Masika Benevolent Payment"
    }

class MemberConstants:
    """Member-related constants"""
    
    MEMBERSHIP_PREFIX = "MS"
    MINIMUM_AGE = 1
    MAXIMUM_AGE = 80
    WAITING_PERIODS = {
        "comfort": 4,
        "dignity": 6,
        "wazazi": 6
    }

class SystemConstants:
    """System-wide constants"""
    
    API_VERSION = "2.0.0"
    MAX_UPLOAD_SIZE = 5 * 1024 * 1024  # 5MB
    RATE_LIMIT_REQUESTS = 100
    RATE_LIMIT_PERIOD = 60  # 1 minute
    CACHE_TTL = 300  # 5 minutes
