import choral.channels.SymChannel;

class MissingCommunications@(A, B) {
	public void send( SymChannel@( A, B )< Object > channel ) {
		Integer@( A ) value = 1@A;
		Integer@( B ) msg0 = channel.< Integer >com( value );
		Integer@( B ) received = msg0;
	}

}
