const express = require("express");
const bodyParser = require("body-parser");
const connectToMongo = require("./db");

const { verifyEsewaPayment, getEsewaPaymentHash } = require("./esewa");

const Payment = require("./paymentModel");
const Item = require("./itemModel");
const PurchasedItem = require("./purchasedItemModel");

const app = express();
app.use(bodyParser.json());

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}
connectToMongo();

app.post("/initialize-esewa", async (req, res) => {
  try {
    const { itemId, totalPrice } = req.body;

    // Ensure `totalPrice` is a valid number
    if (isNaN(Number(totalPrice))) {
      return res.status(400).json({
        success: false,
        message: "Invalid totalPrice value",
      });
    }

    // Validate item exists and the price matches
    const itemData = await Item.findOne({
      _id: itemId,
      price: Number(totalPrice),
    });

    if (!itemData) {
      return res.status(400).send({
        success: false,
        message: "Item not found or price mismatch.",
      });
    }

    // Create a record for the purchase
    const purchasedItemData = await PurchasedItem.create({
      item: itemId,
      paymentMethod: "esewa",
      totalPrice: totalPrice,
    });

    // Initiate payment with eSewa
    const paymentInitiate = await getEsewaPaymentHash({
      amount: totalPrice,
      transaction_uuid: purchasedItemData._id,
    });

    // Respond with payment details
    res.json({
      success: true,
      payment: paymentInitiate,
      purchasedItemData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/complete-payment", async (req, res) => {
  const { data } = req.query; // Data received from eSewa's redirect

  try {
    // Verify payment with eSewa
    const paymentInfo = await verifyEsewaPayment(data);

    // Find the purchased item using the transaction UUID
    const purchasedItemData = await PurchasedItem.findById(
      paymentInfo.response.transaction_uuid
    );

    if (!purchasedItemData) {
      return res.status(500).json({
        success: false,
        message: "Purchase not found",
      });
    }

    // Create a new payment record in the database
    const paymentData = await Payment.create({
      pidx: paymentInfo.decodedData.transaction_code,
      transactionId: paymentInfo.decodedData.transaction_code,
      productId: paymentInfo.response.transaction_uuid,
      amount: purchasedItemData.totalPrice,
      dataFromVerificationReq: paymentInfo,
      apiQueryFromUser: req.query,
      paymentGateway: "esewa",
      status: "success",
    });

    // Update the purchased item status to 'completed'
    await PurchasedItem.findByIdAndUpdate(
      paymentInfo.response.transaction_uuid,
      { $set: { status: "completed" } }
    );

    // Respond with success message
    res.json({
      success: true,
      message: "Payment successful",
      paymentData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "An error occurred during payment verification",
      error: error.message,
    });
  }
});

app.get("/create-item", async (req, res) => {
  let itemData = await Item.create({
    name: "Desktop",
    price: 400,
    inStock: true,
    category: "Legit original",
  });
  res.json({
    success: true,
    item: itemData,
  });
});

app.get("/", function (req, res) {
  res.sendFile(__dirname + "/test.html");
});

app.listen(3001, () => {
  console.log("Backend listening at http://localhost:3001");
});
