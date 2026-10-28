import { redisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { NotificationService } from './notification.service';

const OTP_EXPIRY_SECONDS = 300; // 5 minutes

export const otpService = {
  /**
   * Generates a 6-digit OTP, stores it in Redis against the phone number,
   * and sends it via the Send.lk SMS gateway (falls back to mock if API key missing).
   */
  async sendOtp(phone: string): Promise<void> {
    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store in Redis with expiry
    const redisKey = `otp:${phone}`;
    await redisClient.set(redisKey, otp, 'EX', OTP_EXPIRY_SECONDS);
    
    const message = `Your verification code is: ${otp}. Valid for 5 minutes.`;
    
    try {
      // Use the real SMS gateway if SEND_LK_API_KEY is configured
      await NotificationService.sendBulkSms([phone], message);
      logger.info(`[OTP] Sent OTP to ${phone} via Send.lk`);
    } catch (err) {
      // Fallback: log to console so development still works
      logger.warn(`[OTP] Failed to send SMS via gateway, falling back to console mock`, err);
      console.log(`\n\n=== MOCK SMS ===\nTo: ${phone}\nOTP: ${otp}\n================\n\n`);
    }
  },

  /**
   * Verifies the provided OTP against the stored one in Redis.
   */
  async verifyOtp(phone: string, otp: string): Promise<boolean> {
    const redisKey = `otp:${phone}`;
    const storedOtp = await redisClient.get(redisKey);
    
    if (!storedOtp) {
      throw new Error('OTP has expired or was not requested');
    }
    
    if (storedOtp !== otp) {
      throw new Error('Invalid OTP');
    }
    
    // OTP verified successfully, remove it so it can't be reused
    await redisClient.del(redisKey);
    return true;
  }
};
