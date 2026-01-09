import nodemailer from "nodemailer";
import axios from "axios";

const formatPhoneNumber = (phoneNumber) => {
  let formattedPhone = phoneNumber.replace(/\D/g, ""); 
  
  if (formattedPhone.startsWith("0")) {
    formattedPhone = "62" + formattedPhone.slice(1);
  }
  else if (!formattedPhone.startsWith("62")) {
    formattedPhone = "62" + formattedPhone;
  }
  
  return formattedPhone;
};

export const sendOtpWablas = async (phoneNumber, code) => {
  try {
    const wablasToken = process.env.WABLAS_TOKEN;
    const wablasSecretKey = process.env.WABLAS_SECRET_KEY;
    const wablasApiUrl = process.env.WABLAS_API_URL || "https://sby.wablas.com";

    if (!wablasToken) {
      console.warn("⚠ Wablas API token not configured");
      throw new Error("Wablas API token not configured");
    }

    const formattedPhone = formatPhoneNumber(phoneNumber);

    const message = `Kode OTP Anda adalah: *${code}*\n\nKode ini berlaku selama 5 menit.\nJangan bagikan kode ini kepada siapa pun.`;

    console.log(`📞 Sending WhatsApp OTP to ${formattedPhone} via Wablas...`);
    
    const baseUrl = wablasApiUrl.endsWith('/') ? wablasApiUrl.slice(0, -1) : wablasApiUrl;
    const endpoint = `${baseUrl}/api/send-message`;

    const authorization = wablasSecretKey ? `${wablasToken}.${wablasSecretKey}` : wablasToken;

    const response = await axios.post(
      endpoint,
      {
        phone: formattedPhone,
        message: message,
        priority: 'true', 
      },
      {
        headers: {
          "Authorization": authorization,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 15000,
      }
    );

    console.log(`✓ Wablas Response:`, JSON.stringify(response.data, null, 2));

    if (response.data.status === true || response.data.status === "true") {
      console.log(`✓ OTP WhatsApp sent to ${phoneNumber} via Wablas`);
      return true;
    } else {
      const errorMessage = response.data.message || response.data.reason || 'Unknown error';
      console.warn(`⚠️ Wablas returned error: ${errorMessage}`);
      throw new Error(`Wablas error: ${errorMessage}`);
    }
  } catch (error) {
    console.error("✗ Error sending OTP via Wablas:", error.message);
    if (error.response?.data) {
      console.error("✗ Wablas Error Details:", error.response.data);
    }
    throw error;
  }
};

export const sendWhatsAppNotificationWablas = async (phoneNumber, message) => {
  try {
    const wablasToken = process.env.WABLAS_TOKEN;
    const wablasSecretKey = process.env.WABLAS_SECRET_KEY;
    const wablasApiUrl = process.env.WABLAS_API_URL || "https://sby.wablas.com";

    if (!wablasToken) {
      console.warn("⚠ Wablas API token not configured");
      return false;
    }

    const formattedPhone = formatPhoneNumber(phoneNumber);

    console.log(`📞 Sending WhatsApp notification to ${formattedPhone} via Wablas...`);
    
    const baseUrl = wablasApiUrl.endsWith('/') ? wablasApiUrl.slice(0, -1) : wablasApiUrl;
    const endpoint = `${baseUrl}/api/send-message`;

    const authorization = wablasSecretKey ? `${wablasToken}.${wablasSecretKey}` : wablasToken;

    const response = await axios.post(
      endpoint,
      {
        phone: formattedPhone,
        message: message,
      },
      {
        headers: {
          "Authorization": authorization,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 15000,
      }
    );

    if (response.data.status === true || response.data.status === "true") {
      console.log(`✓ WhatsApp notification sent to ${phoneNumber} via Wablas`);
      return true;
    } else {
      console.log(`✓ WhatsApp notification queued to ${phoneNumber} via Wablas`);
      return true;
    }
  } catch (error) {
    console.error("✗ Error sending WhatsApp notification via Wablas:", error.message);
    return false;
  }
};

export const validateWhatsAppNumberWablas = async (phoneNumber) => {
  try {
    const wablasToken = process.env.WABLAS_TOKEN;
    const wablasSecretKey = process.env.WABLAS_SECRET_KEY;
    const wablasApiUrl = process.env.WABLAS_API_URL || "https://sby.wablas.com";

    if (!wablasToken) {
      throw new Error("Wablas API token not configured");
    }

    const formattedPhone = formatPhoneNumber(phoneNumber);

    console.log(`📞 Validating WhatsApp number: ${formattedPhone} via Wablas...`);
    
    // Use the correct Wablas API endpoint for phone validation
    const baseUrl = wablasApiUrl.endsWith('/') ? wablasApiUrl.slice(0, -1) : wablasApiUrl;
    const authorization = wablasSecretKey ? `${wablasToken}.${wablasSecretKey}` : wablasToken;
    
    // Try the check-number endpoint with POST method
    const response = await axios.post(
      `${baseUrl}/api/check-number`,
      {
        phone: formattedPhone
      },
      {
        headers: {
          "Authorization": authorization,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    console.log(`✓ Wablas Validate Response:`, JSON.stringify(response.data, null, 2));

    // Handle different response formats from Wablas
    if (response.data.status === true || response.data.status === "success") {
      const isOnWhatsApp = response.data.onwhatsapp === true || 
                          response.data.onwhatsapp === "true" ||
                          response.data.data?.status === "online" ||
                          response.data.result === true;
      
      return {
        isRegistered: isOnWhatsApp,
        phone: formattedPhone,
        message: isOnWhatsApp ? "Nomor WhatsApp valid dan terdaftar" : "Nomor tidak terdaftar di WhatsApp"
      };
    } else {
      // If API returns error but number might still be valid, allow it to proceed
      console.warn("⚠ Wablas validation returned non-success, allowing number anyway");
      return {
        isRegistered: true, // Allow to proceed
        phone: formattedPhone,
        message: "Validasi tidak dapat dilakukan, nomor diizinkan"
      };
    }
  } catch (error) {
    console.error("✗ Error validating WhatsApp number via Wablas:", error.message);
    
    // If validation fails, allow the number to proceed (fail-open)
    // This prevents blocking users if Wablas API is down
    console.warn("⚠ Wablas validation failed, allowing number to proceed");
    return {
      isRegistered: true, // Allow to proceed even if validation fails
      phone: formatPhoneNumber(phoneNumber),
      message: "Validasi tidak dapat dilakukan, nomor diizinkan untuk melanjutkan"
    };
  }
};

export const sendOtpEmail = async (email, code) => {
  try {
    const emailTransporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Your OTP Verification Code",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f5f5f5;">
          <div style="background-color: white; padding: 30px; border-radius: 8px; max-width: 500px; margin: 0 auto;">
            <h2 style="color: #333; text-align: center; margin-bottom: 20px;">Email Verification</h2>
            <p style="color: #666; text-align: center; margin-bottom: 30px;">Your OTP code is:</p>
            <h1 style="color: #007bff; letter-spacing: 5px; text-align: center; font-size: 48px; margin: 30px 0;">${code}</h1>
            <p style="color: #999; text-align: center; font-size: 14px; margin-bottom: 30px;">This code will expire in 10 minutes.</p>
            <p style="color: #999; text-align: center; font-size: 12px;">If you didn't request this, please ignore this email.</p>
          </div>
        </div>
      `,
    };

    await emailTransporter.sendMail(mailOptions);
    console.log(`✓ OTP email sent to ${email}`);
    return true;
  } catch (error) {
    console.error("✗ Error sending OTP email:", error.message);
    throw error;
  }
};

export const sendOtpWhatsApp = async (phoneNumber, code) => {
  const provider = process.env.WHATSAPP_PROVIDER || "wablas";
  
  console.log(`📱 WhatsApp Provider: ${provider}`);
  
  if (provider === "wablas") {
    return await sendOtpWablas(phoneNumber, code);
  }
  
  try {
    const fontteToken = process.env.FONNTE_API_TOKEN;
    const fontteApiUrl = process.env.FONNTE_API_URL || "https://api.fonnte.com/";

    if (!fontteToken) {
      console.warn("⚠ Fonnte API token not configured, trying Wablas...");
      return await sendOtpWablas(phoneNumber, code);
    }

    let formattedPhone = phoneNumber.replace(/\D/g, "");
    
    if (formattedPhone.startsWith("0")) {
      formattedPhone = "62" + formattedPhone.slice(1);
    }
    else if (!formattedPhone.startsWith("62")) {
      formattedPhone = "62" + formattedPhone;
    }

    const message = `Your OTP verification code is: ${code}\n\nThis code will expire in 10 minutes.\n\nDo not share this code with anyone.`;

    console.log(`📞 Sending WhatsApp OTP to ${formattedPhone} via Fonnte...`);
    console.log(`🔑 Using Fonnte token: ${fontteToken.substring(0, 10)}...`);
    
    const baseUrl = fontteApiUrl.endsWith('/') ? fontteApiUrl.slice(0, -1) : fontteApiUrl;
    const endpoint = `${baseUrl}/send`;

    try {
      console.log(`📍 Endpoint: ${endpoint}`);
      
      const response = await axios.post(
        endpoint,
        {
          target: formattedPhone,
          message: message,
        },
        {
          headers: {
            "Authorization": fontteToken,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );

      console.log(`✓ Fonnte Response:`, response.data);

      if (response.data.status === true) {
        console.log(`✓ OTP WhatsApp sent to ${phoneNumber}`);
        return true;
      } else if (response.data.status === false) {
        const reason = response.data.reason || response.data.message || 'Unknown error';
        console.warn(`⚠️ Fonnte returned status false: ${reason}`);
        
        if (reason.includes('no target') || reason.includes('invalid')) {
          throw new Error(`Invalid phone number: ${reason}`);
        }
        
        console.log(`✓ Message queued (status=${response.data.status})`);
        return true;
      } else {
        console.log(`✓ OTP WhatsApp sent to ${phoneNumber}`);
        return true;
      }
    } catch (error) {
      console.error(`✗ Failed to send OTP via Fonnte:`, error.message);
      console.log(`🔄 Trying Wablas as fallback...`);
      return await sendOtpWablas(phoneNumber, code);
    }

  } catch (error) {
    console.error("✗ Error sending OTP WhatsApp:", error.message);
    if (error.response?.data) {
      console.error("✗ Fonnte Error Details:", error.response.data);
    }
    throw error;
  }
};

export const sendWhatsAppNotification = async (phoneNumber, message) => {
  const provider = process.env.WHATSAPP_PROVIDER || "wablas";
  
  if (provider === "wablas") {
    return await sendWhatsAppNotificationWablas(phoneNumber, message);
  }
  
  try {
    const fontteToken = process.env.FONNTE_API_TOKEN;
    const fontteApiUrl = process.env.FONNTE_API_URL || "https://api.fonnte.com/";

    if (!fontteToken) {
      console.warn("⚠ Fonnte API token not configured, trying Wablas...");
      return await sendWhatsAppNotificationWablas(phoneNumber, message);
    }

    let formattedPhone = phoneNumber.replace(/\D/g, "");
    if (formattedPhone.startsWith("0")) {
      formattedPhone = "62" + formattedPhone.slice(1);
    } else if (!formattedPhone.startsWith("62")) {
      formattedPhone = "62" + formattedPhone;
    }

    console.log(`📞 Sending WhatsApp notification to ${formattedPhone}...`);

    const baseUrl = fontteApiUrl.endsWith('/') ? fontteApiUrl.slice(0, -1) : fontteApiUrl;
    const endpoint = `${baseUrl}/send`;

    const response = await axios.post(
      endpoint,
      {
        target: formattedPhone,
        message: message,
      },
      {
        headers: {
          "Authorization": fontteToken,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    if (response.data.status === true) {
      console.log(`✓ WhatsApp notification sent to ${phoneNumber}`);
      return true;
    } else {
      console.log(`✓ WhatsApp notification queued to ${phoneNumber}`);
      return true;
    }
  } catch (error) {
    console.error("✗ Error sending WhatsApp notification:", error.message);
    return false;
  }
};

export const sendOtpSms = async (phoneNumber, code) => {
  try {
    const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!twilioAccountSid || !twilioAuthToken) {
      console.warn("⚠ Twilio credentials not configured");
      return false;
    }

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;

    await axios.post(
      twilioUrl,
      {
        From: twilioPhoneNumber,
        To: phoneNumber,
        Body: `Your OTP verification code is: ${code}. This code will expire in 10 minutes.`,
      },
      {
        auth: {
          username: twilioAccountSid,
          password: twilioAuthToken,
        },
      }
    );

    console.log(`✓ OTP SMS sent to ${phoneNumber}`);
    return true;
  } catch (error) {
    console.error("✗ Error sending OTP SMS:", error.message);
    throw error;
  }
};

export const validateWhatsAppNumber = async (phoneNumber) => {
  const provider = process.env.WHATSAPP_PROVIDER || "wablas";
  
  if (provider === "wablas") {
    return await validateWhatsAppNumberWablas(phoneNumber);
  }
  
  try {
    const fontteToken = process.env.FONNTE_API_TOKEN;
    const fontteApiUrl = process.env.FONNTE_API_URL || "https://api.fonnte.com/";

    if (!fontteToken) {
      console.warn("⚠ Fonnte API token not configured, trying Wablas...");
      return await validateWhatsAppNumberWablas(phoneNumber);
    }

    let formattedPhone = phoneNumber.replace(/\D/g, "");
    
    if (formattedPhone.startsWith("0")) {
      formattedPhone = "62" + formattedPhone.slice(1);
    }
    else if (!formattedPhone.startsWith("62")) {
      formattedPhone = "62" + formattedPhone;
    }

    console.log(`📞 Validating WhatsApp number: ${formattedPhone} via Fonnte...`);
    
    const baseUrl = fontteApiUrl.endsWith('/') ? fontteApiUrl.slice(0, -1) : fontteApiUrl;
    const endpoint = `${baseUrl}/validate`;

    const response = await axios.post(
      endpoint,
      {
        target: formattedPhone,
        countryCode: '62'
      },
      {
        headers: {
          "Authorization": fontteToken,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    console.log(`✓ Fonnte Validate Response:`, JSON.stringify(response.data, null, 2));

    if (response.data.status === true) {
      const registeredArray = response.data.registered || [];
      const notRegisteredArray = response.data.not_registered || [];
      
      const isInRegistered = registeredArray.some(num => {
        const cleanNum = String(num).replace(/\D/g, '');
        const cleanFormatted = formattedPhone.replace(/\D/g, '');
        return cleanNum === cleanFormatted || 
               cleanNum.endsWith(cleanFormatted.slice(-10)) ||
               cleanFormatted.endsWith(cleanNum.slice(-10));
      });
      
      const isInNotRegistered = notRegisteredArray.some(num => {
        const cleanNum = String(num).replace(/\D/g, '');
        const cleanFormatted = formattedPhone.replace(/\D/g, '');
        return cleanNum === cleanFormatted || 
               cleanNum.endsWith(cleanFormatted.slice(-10)) ||
               cleanFormatted.endsWith(cleanNum.slice(-10));
      });
      
      if (isInRegistered) {
        return {
          isRegistered: true,
          phone: formattedPhone,
          message: "Nomor WhatsApp valid dan terdaftar"
        };
      } else if (isInNotRegistered) {
        return {
          isRegistered: false,
          phone: formattedPhone,
          message: "Nomor tidak terdaftar di WhatsApp"
        };
      } else {
        if (registeredArray.length > 0) {
          return {
            isRegistered: true,
            phone: formattedPhone,
            message: "Nomor WhatsApp valid dan terdaftar"
          };
        }
        if (notRegisteredArray.length === 0) {
          return {
            isRegistered: true,
            phone: formattedPhone,
            message: "Nomor WhatsApp valid"
          };
        }
        return {
          isRegistered: false,
          phone: formattedPhone,
          message: "Nomor tidak terdaftar di WhatsApp"
        };
      }
    } else {
      const reason = response.data.reason || "Gagal memvalidasi nomor";
      throw new Error(reason);
    }

  } catch (error) {
    console.error("✗ Error validating WhatsApp number:", error.message);
    if (error.response?.data) {
      console.error("✗ Fonnte Error Details:", error.response.data);
    }
    throw error;
  }
};
