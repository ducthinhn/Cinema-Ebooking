package com.cinemaebooking.backend.notification.infrastructure.adapter;

import com.cinemaebooking.backend.notification.application.port.QRCodeService;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.client.j2se.MatrixToImageWriter;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.util.Base64;
import java.util.Map;

@Slf4j
@Service
public class QRCodeServiceImpl implements QRCodeService {


    @Override
    public byte[] generateQRCode(String bookingCode, int width, int height) {
        try {
            QRCodeWriter qrCodeWriter = new QRCodeWriter();

            BitMatrix bitMatrix = qrCodeWriter.encode(
                    bookingCode,
                    BarcodeFormat.QR_CODE,
                    width,
                    height,
                    Map.of(
                            EncodeHintType.MARGIN, 2,
                            EncodeHintType.CHARACTER_SET, "UTF-8"
                    )
            );

            ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
            MatrixToImageWriter.writeToStream(bitMatrix, "PNG", outputStream);
            return outputStream.toByteArray();

        } catch (Exception e) {
            log.error("Failed to generate QR code for booking: {}", bookingCode, e);
            throw new RuntimeException("QR code generation failed", e);
        }
    }

    @Override
    public String generateQRCodeBase64(String bookingCode, int width, int height) {
        byte[] qrBytes = generateQRCode(bookingCode, width, height);
        return Base64.getEncoder().encodeToString(qrBytes);
    }
}