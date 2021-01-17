const functions = require('firebase-functions');
var stripe = require('stripe')('sk_test_rOV4w8JxWq09J6uZDxgk14rE00AI1lQQ8X');
const admin = require("firebase-admin");
const nodemailer = require('nodemailer');
var dateFormat = require('dateformat');

var accountSid = 'ACac3eb67b1a80773bfcd2e46bbd2e2b86'; // Your Account SID from www.twilio.com/console
var authToken = '8dc0eea56e93b1069e5f65ec52deb8a9';   // Your Auth Token from www.twilio.com/console

var twilio = require('twilio');
var client = new twilio(accountSid, authToken);

admin.initializeApp();
const db = admin.firestore();

const twilioPhoneNumber = "+12038134857"

exports.addCanceAppointmentStatus = functions.firestore
    .document('appointments/{uid}')
    .onCreate(async (snap, context) => {

		const data = snap.data();
		const uid = context.params.uid

		let appointmentRef = db.collection('appointments')
		let appointmentDoc = appointmentRef.doc(uid)

		try {	
			let appt = appointmentDoc.set({
				"canceled":false
			}, {merge:true})
			return appt
		}catch(err) {
			throw err
		}

    });

exports.createStripeCustomer = functions.firestore
    .document('Profiles/{uid}')
    .onCreate(async (snap, context) => {

		const data = snap.data();
		const uid = context.params.uid

		try {	
			//const verif = await createVerificationCode("0000");
			const user = await getAuthUser(uid)
			const customer = await createCustomer(user.uid, user.email, data.first_name, data.last_name)
			const profile = await updateProfile(user.uid, customer.id)
			return profile
		}catch(err) {
			throw err
		}

  });

exports.updateStripeCustomer = functions.firestore
    .document('Profiles/{uid}')
    .onUpdate(async (change, context) => {

		const newValue = change.after.data();
		const firstName = newValue.first_name;
		const lastName = newValue.last_name;

		try {	
			const customer = await updateCustomer(newValue.customerID, firstName, lastName)
			return customer
		}catch(err) {
			console.log(err)
			throw err
		}

    });


exports.cancelAppointment = functions.https.onCall(async (data, context) => { 
	const appointmentID = data.appointmentID

 	try {
 		const appt = await getAppointment(appointmentID)
 		await updateAppointment(appointmentID, { canceled:true })

 		const refund = await refundCharge(appt.chargeID)
 		return refund
 	}catch(err) {
 		throw err
 	}
});

exports.addCard = functions.https.onCall(async (data, context) => { 
 	try {
 		const customerID = await getCustomerID(context)
 		const token = await getToken(data)
 		const card = await addPaymentSource(customerID, token)
 		return card
 	}catch(err) {
 		throw err
 	}
});


exports.getCards = functions.https.onCall(async (data, context) => {
 	try {
 		const customerID = await getCustomerID(context)
 		const cards = await getAllCards(customerID)
 		return cards
 	}catch(err) {
 		throw err
 	}
});

exports.checkout = functions.https.onCall(async (data, context) => {
	try{
		const cardID = data.cardID
		const trainerID = data.trainerID
		const trainer = await getTrainer(trainerID)
		const type = "General" 
		const length = "1 hour"
		const date = admin.firestore.Timestamp.fromMillis(Date.now())

		const appointment = await book(context, cardID, type, date, length, trainer, trainerID);
		return appointment
	}catch(err) {
		throw err
	}
});

async function book(context, cardID, type, date, len, trainer, trainerID) {
 	try {
 		
		const uid = context.auth.uid
		const appointmentDate = date
		const length = len

		const hasOrderInProgress = await doesUserHasInProgressOrder(uid);
 		const customerID = await getCustomerID(context)
 		const location = await getLocation(trainer.currentLocation.path)
 		const card = await getCardById(customerID, cardID)
 		const charge = await createCharge(trainer.hourlyPrice, card.id, customerID)
 		const user = await getAuthUser(uid)
 		const profile = await getProfile(uid)

 		const appointment = await createAppointment(context.auth.uid, charge.id, trainer.currentLocation.id, trainerID, true, appointmentDate, type, length, trainer.gender)
		
		const appt = await getAppointment(appointment.id)
 		
 		const apptDate = appt.arriveAt.toDate()
 		const longDate = dateFormat(apptDate, "fullDate", true);
		const shortTime = dateFormat(apptDate, "shortTime", true);

 		await sendEmail(user.email, "New Appointment", `${ profile.first_name }, <br><br> You booked a new training session with ${trainer.first_name} ${trainer.last_name} on ${longDate} at ${shortTime}. View your receipt here ${charge.receipt_url}`)
 		//await sendSMS(profile.phone, `You booked an appointment with ${trainer.first_name} ${trainer.last_name} at ${location.name}.`)
 		return appointment
 	}catch(err) {
 		throw err
 	}
}

exports.createAppointment = functions.https.onCall(async (data, context) => {
	try{
		const type = data.type
		const gender = data.gender
		const length = data.length

	 	const appointment = await book(data,context);
	 	return appointment
	}catch(err) {
		throw err
	}
});


exports.getProducts = functions.https.onCall(async (data, context) => {
	try{
	 const products = await getProducts();
	 return products
	}catch(err) {
		throw err
	}
});

exports.getPrices = functions.https.onCall(async (data, context) => {
	try{
	 const productId = data.productID
	 const prices = await getPrices(productId);
	 return prices
	}catch(err) {
		throw err
	}
});

exports.getPriceByID = functions.https.onCall(async (data, context) => {
	try{
	 const priceID = data.priceID
	 const price = await getPriceByID(priceID);
	 return price
	}catch(err) {
		throw err
	}
});

exports.searchForTrainer = functions.https.onCall(async (data, context) => {
	try{
		const productID = data.productID
		const cardID = data.cardID
		const priceID = data.priceID
		const gender = data.gender;
		const length = "5 hours"
		const arriveAt = data.arriveAt;
		const date = admin.firestore.Timestamp.fromDate(new Date(arriveAt));
		const productType = "Get from stripe"
		var trainer;
		const query = await db.collection('trainers').where('gender', '==', gender).get();

	    if (!query.empty) {
	    	const snapshot = query.docs[0];
	    	trainerData = snapshot.data();
			const appointment = await book(context, cardID, productType, date, length, trainerData, snapshot.id);
	    	return appointment;
	    } else {
	  		throw new functions.https.HttpsError('invalid-argument', "No trainers found")
	    }
	 
	}catch(err) {
		throw err
	}
});


function getPrices(productID) {
	return new Promise(function(resolve, reject){
		stripe.prices.list(
		  {limit: 6, product:productID},
		  function(err, prices) {
		  	if(err) { reject(new functions.https.HttpsError('invalid-argument', err.message)) }
		    resolve(prices)
		  }
		);
	})
}


function getPriceByID(priceID) {
	return new Promise(function(resolve, reject){
		stripe.prices.retrieve(
		  priceID,
		  function(err, price) {
		  	if(err){ reject(new functions.https.HttpsError('invalid-argument', err.message)) }
		  	resolve(price)
		  }
		);
	})
}

function getProducts() {
		return new Promise(function(resolve, reject){
		stripe.products.list(
		  {limit: 10},
		  function(err, products) {
		  	if(err) { reject(new functions.https.HttpsError('invalid-argument', err.message)) }
		  	resolve(products)
		  }
		);
	})
}











exports.getCardByID = functions.https.onCall(async (data, context) => {
	try{
		const customerID = await getCustomerID(context)
 		const card = await getCardById(customerID, data.id)
 		return card
	}catch(err) {
		throw err
	}
});

exports.updateCardById = functions.https.onCall(async (data, context) => {
	try{
		const customerID = await getCustomerID(context)
 		const card = await updatePaymentSource(customerID, data.id, data.card)
 		return card
	}catch(err) {
		throw err
	}
});

exports.deleteCardById = functions.https.onCall(async (data, context) => {
	try{
		const customerID = await getCustomerID(context)
 		const confirmation = await deletePaymentSource(customerID, data.id)
 		return confirmation
	}catch(err) {
		throw err
	}
});

exports.getCharge = functions.https.onCall(async (data, context)=>{
	const chargeID = data.chargeID
	try{
		const charge = await getCharge(chargeID)
 		return charge
	}catch(err) {
		throw err
	}
})

function createVerificationCode(code) {
	let verifRef = db.collection('Verification')
	return verifRef.add({
		code:code
	})
}


function refundCharge(chargeID) {
	return new Promise(function(resolve, reject){
		stripe.refunds.create(
		  {charge: chargeID},
		  function(err, refund) {
		  	if(err) { reject(new functions.https.HttpsError('invalid-argument', err.message)) }
		  	resolve(refund)
		  }
		);
	})	
}


function getCharge(chargeID) {
	return new Promise(function(resolve, reject){
		stripe.charges.retrieve(
		  chargeID,
		  function(err, charge) {
		  	if(err) { reject(new functions.https.HttpsError('invalid-argument', err.message)) }
		  	resolve(charge)
		  }
		);
	})
}

function updateAppointment(appointmentID, data) {
	let appointmentRef = db.collection('appointments')
	let appointmentDoc = appointmentRef.doc(appointmentID)
	return appointmentDoc.set(data, {merge:true})
}

function getAppointment(appointmentID) {
	let appoinrmentRef = db.collection('appointments').doc(appointmentID);
	return new Promise(function(resolve, reject){
		return appoinrmentRef.get().then(appointment => {
			if(!appointment.exists){ return reject(new functions.https.HttpsError('invalid-argument', "Appointment doesn't exist")) }
			let data = appointment.data()
			return resolve(data)
		})
	})
}


function getProfile(userID) {
	let profileRef = db.collection('Profiles').doc(userID);
	return new Promise(function(resolve, reject){
		return profileRef.get().then(profile => {
			if(!profile.exists){ return reject(new functions.https.HttpsError('invalid-argument', 'Profile doesnt exist')) }
			const profileData = profile.data()
			return resolve(profileData)
		})
	})

}

function createCustomer(userID, email, firstName, lastName) {
	return stripe.customers.create({name:`${firstName} ${lastName}`, description: `iTrayne client ${userID}`, email:email});
}

function updateCustomer(customerId, firstName, lastName) {
	return new Promise(function(resolve, reject){
		stripe.customers.update(customerId, {name:`${firstName} ${lastName}`}, function(err, customer){
			if(err) { reject(new functions.https.HttpsError('invalid-argument', err.message)) }
			resolve(customer)
		});
	})
	
}

function updateProfile(userID, customerId) {
	let profileRef = db.collection('Profiles').doc(userID);
	return profileRef.set({ customerID:customerId }, { merge:true })	
}


function getAuthUser(userUID) {
	return admin.auth().getUser(userUID)
}


function createCharge(amount, cardID, customerID) {
	return new Promise(function(resolve, reject){
		stripe.charges.create(
		  {
		    amount: amount,
		    currency: 'usd',
		    source: cardID,
		    customer: customerID,
		    description: 'Charge for training session.',
		  },
		  function(err, charge) {
		  	if (err){ return reject(new functions.https.HttpsError('invalid-argument', err.message)) }
		    return resolve(charge)
		  }
		);
	})
}

function createAppointment(userID, chargeID, locationID, trainerID, pending, appointmentDate, type, length, gender) {
	let appointmentRef = db.collection('appointments')
	let locationRef = db.collection('locations')
	let trainerRef = db.collection('trainers')
	let clientRef = db.collection('Profiles')
	return appointmentRef.add({
					chargeID:chargeID,
					location:locationRef.doc(locationID),
		  			trainer:trainerRef.doc(trainerID),
		  			userID:clientRef.doc(userID),
		  			created: admin.firestore.Timestamp.fromMillis(Date.now()),
		  			arriveAt:appointmentDate,
		  			pending:pending,
		  			type:type,
		  			length:length,
		  			gender:gender
		  		})
}

function getLocation(documentReference) {
	return new Promise(function(resolve, reject){
		let locationRef = db.doc(documentReference);
		return locationRef.get().then(location => {
			if(!location.exists) { reject(new functions.https.HttpsError('invalid-argument', "This trainer isn't at this location. Try again.")) }
			let locationData = location.data();
			return resolve(locationData)
		})
	})
}

function getTrainer(trainerId) {
	return new Promise(function(resolve, reject){
		let trainerRef = db.collection('trainers').doc(trainerId);
		return trainerRef.get().then(trainer => {
			if(!trainer.exists){ reject(new functions.https.HttpsError('invalid-argument', "Trainer doesn't exist")) }
			const trainerData = trainer.data()
			return resolve(trainerData)
		})
	})
}


function getAvailableTrainer(gender) {
	const citiesRef = db.collection('trainers');
	const snapshot = citiesRef.where('gender', '==', gender).get();
	return new Promise(function(res, rej){
		return snapshot.then(qsnapshot => {
			if (qsnapshot.empty) { return rej(new functions.https.HttpsError('invalid-argument', "No trainers available")) }
			else{ 
				var data = []
				qsnapshot.forEach(trainer => {
					data.push(trainer)
				})
				return res(data[0].data())
			}
			
		})
	})
}

function getCustomerID(context) {
	return new Promise(function(resolve, reject){
		if(!context.auth){ reject(new functions.https.HttpsError('invalid-argument', "User not logged in.")) }
		let profileRef = db.collection('Profiles').doc(context.auth.uid);
		return profileRef.get().then(profile => {
			if(!profile.exists){ reject(new functions.https.HttpsError('invalid-argument', "Profile doesn't exist")) }
			const profileData = profile.data()
			if(profileData.customerID && profileData.customerID.length) {
				return resolve(profileData.customerID)
			}else{
				return reject(new functions.https.HttpsError('invalid-argument', "User has no customer ID."))
			}
		})

	})
}



function deletePaymentSource(customerId, cardId) {
	return new Promise(function(resolve, reject){
		stripe.customers.deleteSource(
		  customerId,
		  cardId,
		  function(err, confirmation) {
		  	if(err) { reject(new functions.https.HttpsError('invalid-argument', err.message)) }
		  	else { resolve(confirmation) }
		  }
		);
	})
}

function addPaymentSource(customerId, token) {
	return new Promise(function(resolve, reject){
		stripe.customers.createSource(
		  customerId,
		  {source: token.id},
		  function(err, card) {
		  	if(err) { reject(new functions.https.HttpsError('invalid-argument', err.message)) }
		  	else { resolve(card) }
		  }
		);
	})
}

function updatePaymentSource(customerId, cardId, card) {
	return new Promise(function(resolve, reject){
		stripe.customers.updateSource(
		  customerId,
		  cardId,
		  card,
		  function(err, card) {
		  	if(err) { reject(new functions.https.HttpsError('invalid-argument', err.message)) }
		  	else { resolve(card) }
		  }
		);
	})
}

function getCardById(customerID, cardId) {
	return new Promise(function(resolve, reject){
		if(cardId && cardId.length) { 
			stripe.customers.retrieveSource(
			  customerID,
			  cardId,
			  function(err, card) {
			  	if(err) { reject(new functions.https.HttpsError('invalid-argument', err.message)) }
			  	else{ resolve(card) }
			  }
			);
		}else{
			reject(new Error("No Card ID"))
		}
	})
}

function getAllCards(customerID) {
	return new Promise(function(resolve, reject){
		stripe.customers.listSources(
		  customerID,
		  {object: 'card', limit: 8},
		  function(err, cards) {
		  	if(err) { reject(new functions.https.HttpsError('invalid-argument', err.message)) }
			else { resolve(cards) }		  
		  }
		);
	})
}

function getToken(card) {
	return new Promise(function(resolve, reject){
	  	stripe.tokens.create(
		  {
		    card:card,
		  },
		  function(err, token) {
		  	if(err) { reject(new functions.https.HttpsError('invalid-argument', err.message))}
		  	else{ resolve(token) }
		  }
		);	
	})
}

function doesUserHasInProgressOrder(userId){
	let profileDocumentRef = db.collection("Profiles").doc(userId);
	let appointmentCollectionRef = db.collection("appointments");
	return new Promise(function(res, rej){
		return appointmentCollectionRef.where("userID", "==", profileDocumentRef).where("canceled", "==", false).get()
		.then(appointments => {
			if(appointments.empty){
				return res(true);
			}else{
				return rej(new functions.https.HttpsError('invalid-argument', "You have a order in progress. You can only book one appointment at a time."))
			}
		})
	})
}


function sendEmail(email, subject, body) {
	const transporter = nodemailer.createTransport({
	  service: 'gmail',
	  auth: {
	    user: 'chris.kendricks07@gmail.com',
	    pass: 'jckzyowhikpvbqmc' // naturally, replace both with your real credentials or an application-specific password
	  }
	});

	const mailOptions = {
	  from: 'chris.kendricks07@gmail.com',
	  to: email,
	  subject: subject,
	  html: body
	};
	return new Promise(function(resolve, reject){
		transporter.sendMail(mailOptions, function(error, info){
		  if (error) {
			reject(new functions.https.HttpsError('invalid-argument', error.message));
		  } else {
		    resolve(info.response);
		  }
		});
	})
}

exports.incomingCall = functions.https.onRequest(async (req, res) => {
	const callerPhoneNumber = req.body.From;
	const response = new twilio.twiml.VoiceResponse();
	response.say("Connecting you to your eye train trainer");
	response.dial("+18183699276");
	res.set('Content-Type', 'text/xml');
  	res.send(response.toString());
})

// Twilio

function sendSMS(phoneNumber, message) {
	return client.messages.create({
    body: message,
    to: `+1${phoneNumber}`,  // Text this number
    from: twilioPhoneNumber // From a valid Twilio number
 })
}

function dialNumber(res, number, say) {
	const response = new twilio.twiml.VoiceResponse();
	response.say(say);
	response.dial("+13233303083");
	res.set('Content-Type', 'text/xml');
  	res.send(response.toString());
}

function findTrainerByPhoneNumber(phoneNumber) {
	return new Promise(function(resolve, reject){
		let trainerRef = db.collection('trainers').doc(trainerId);
		return trainerRef
			.where("phone", "==", phoneNumber)
			.get()
			.then(trainer => {
				if(!trainer.exists){ reject(new functions.https.HttpsError('invalid-argument', "Trainer doesn't exist")) }
				const trainerData = trainer.data()
				return resolve(trainerData)
		})
	})
}




