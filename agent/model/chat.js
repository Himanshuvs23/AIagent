import mongoose from "mongoose";


const { Schema, model } = mongoose;


const conversationSchema = new Schema(
  {
    title: {
      type: String,
      default: "New Chat",
    },
  },
  {
    timestamps: true, 
  }
);

const messageSchema= new Schema(
{
    chatId :{
        type: Schema.Types.ObjectId,
        ref : "conversation",
        required: true,
    } ,
    role: {
        type: String,
        enum: ["user", "assistant" , "system" , "tool"],
        required: true,
    },
    content :{
        type: String,
        required: true,
    },
},
 {
    timestamps: true
  }

);

messageSchema.index({ chatId: 1 });

const Message = model("message",messageSchema);
const Conversation = model("conversation",conversationSchema);

export { Message, Conversation };