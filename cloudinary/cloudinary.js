require("dotenv").config();
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadImage(imageUrl) {
  const result = await cloudinary.uploader.unsigned_upload(imageUrl, process.env.CLOUDINARY_UPLOAD_PRESET);
  return {
    public_id: result.public_id,
    secure_url: result.secure_url,
    width: result.width,
    height: result.height,
  };
}

function generateSmartCroppedUrl(publicId, options = {}) {
  return cloudinary.url(publicId, {
    crop: "auto",
    gravity: "auto:utensil",
    width: options.width || 300,
    height: options.height || 300,
    quality: "100",
    sign_url: true
  });
}

module.exports = { uploadImage, generateSmartCroppedUrl };